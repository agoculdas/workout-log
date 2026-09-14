/**
 * Personal records — the long view over one exercise's logged sets.
 *
 * A record here is a *fact*, nothing more: the best number you have put up for
 * this exercise, and when. Nothing in this file feeds `suggestLoad`,
 * `isStalled` or any other suggestion — set facts never drive the programme.
 *
 * Two rules run through everything:
 *
 * - **Warm-ups never count.** Every tally filters through `workingSets` first,
 *   and `setBeats` returns nothing for a warm-up row.
 * - **Loads are compared in the exercise's *current* denomination.** A set
 *   stores the denomination it was entered in, so an exercise switched from kg
 *   to lb has each historic set converted through kilograms before it is
 *   compared — 100 kg logged last month still outranks 200 lb logged today.
 *
 * ### "First ever" is not a record
 *
 * `computeRecords` is the primitive: it reports the best of whatever history it
 * is handed, including a single session. `setBeats` is the one that decides
 * whether a set just set a *personal record*, and it answers "no" whenever the
 * records it is given carry no entry of that kind. Callers pass records
 * computed from the *prior* history (`getExerciseRecords(id, {
 * excludeSessionId })`), so on the very first session of an exercise every kind
 * is missing and nothing is flagged. The second session is the first that can
 * beat anything — which is what "records start from your second session of an
 * exercise" means everywhere in the UI.
 */
import type { Exercise, ExerciseSessionHistory, SetLog } from '../db/types';
import { formatDuration, formatMassUnit, formatNumber } from './format';
import { workingSets } from './sets';
import { exerciseMassUnit, fromKg, massLabel, setMassUnit, toKg } from './units';

/** One record: the number, the set behind it, and when it happened. */
export interface RecordEntry {
  /** The record value itself, in the exercise's current denomination. */
  value: number;
  /** The set's load, when the record came from a single set. */
  load?: number;
  /** The set's reps / seconds / laps, when the record came from a single set. */
  reps?: number;
  sessionId: string;
  /** `SetLog.completedAt` of the set that set it (the last one, for a session record). */
  at: number;
}

/**
 * Every record an exercise can hold. Only the kinds that make sense for the
 * exercise are ever filled in — see `recordKindsFor`.
 */
export interface ExerciseRecords {
  /** Best estimated 1RM, Epley: load x (1 + reps / 30). Sets of 1-12 reps only. */
  e1rm?: RecordEntry;
  /** Heaviest working set. Equal load with more reps wins. */
  heaviest?: RecordEntry;
  /** Most reps in one set — band / bodyweight / unloaded work. */
  mostReps?: RecordEntry;
  /** Longest single hold, in seconds. */
  longest?: RecordEntry;
  /** Fastest time, in seconds — conditioning only, where lower is better. */
  bestTime?: RecordEntry;
  /**
   * Best session volume (load x reps summed), in the exercise's own numbers.
   *
   * Deliberately *native*: `Settings.countBodyweight` changes what a session
   * total says (see `totalVolumeKg`), but it never reaches here. A record is
   * the number you put up, and turning a display option on or off must not
   * rewrite the book — nor can it, since `bestVolume` only applies to loaded
   * rep work, where bodyweight counts for nothing anyway.
   */
  bestVolume?: RecordEntry;
}

export type RecordKind = keyof ExerciseRecords;

/** Kinds a single set can beat. Session volume is not one of them. */
export type SetRecordKind = Exclude<RecordKind, 'bestVolume'>;

/** What each kind is called in the UI. The value string carries the number. */
export const RECORD_LABELS: Record<RecordKind, string> = {
  e1rm: 'Strongest set',
  heaviest: 'Heaviest',
  mostReps: 'Most reps',
  longest: 'Longest hold',
  bestTime: 'Best time',
  bestVolume: 'Best session volume',
};

/** Epley's estimated one-rep max. Garbage in (NaN, negatives) gives 0. */
export function epley1RM(load: number, reps: number): number {
  if (!Number.isFinite(load) || !Number.isFinite(reps)) return 0;
  if (load <= 0 || reps <= 0) return 0;
  return load * (1 + reps / 30);
}

/** Anything with a real external load: the only units where "heaviest" means something. */
function isLoaded(exercise: Pick<Exercise, 'unit'>): boolean {
  return exercise.unit === 'kg_side' || exercise.unit === 'kg_total';
}

/**
 * Which records apply to this exercise, in display order (primary first,
 * session volume last):
 *
 * - conditioning timed work -> `bestTime` alone; nothing else is meaningful.
 * - loaded rep work -> `e1rm`, `heaviest`, `bestVolume`.
 * - loaded timed work -> `heaviest`, `longest`.
 * - band / bodyweight / unloaded rep work -> `mostReps`.
 * - any non-conditioning timed work -> `longest`.
 */
export function recordKindsFor(exercise: Exercise): RecordKind[] {
  if (exercise.type === 'conditioning' && exercise.measure === 'seconds') {
    return ['bestTime'];
  }
  const loaded = isLoaded(exercise);
  const kinds: RecordKind[] = [];
  if (loaded && exercise.measure === 'reps') kinds.push('e1rm');
  if (loaded) kinds.push('heaviest');
  if (!loaded && exercise.measure === 'reps') kinds.push('mostReps');
  if (exercise.measure === 'seconds') kinds.push('longest');
  if (loaded && exercise.measure === 'reps') kinds.push('bestVolume');
  return kinds;
}

/**
 * A set's load read in the exercise's *current* denomination, via kilograms.
 * Same-denomination sets (the overwhelming majority) are returned untouched so
 * comparisons stay exact; converted ones are trimmed of float dust.
 */
function loadIn(exercise: Exercise, set: Pick<SetLog, 'load' | 'massUnit'>): number {
  const to = exerciseMassUnit(exercise);
  const from = setMassUnit(set);
  if (from === to) return set.load;
  return Number(fromKg(toKg(set.load, from), to).toFixed(6));
}

/**
 * Every record this exercise holds over `history` — which must be that
 * exercise's *completed* sessions, oldest to newest (what
 * `getExerciseRecords` hands over). Ties keep the earlier session: a record has
 * to be beaten, not matched.
 *
 * Zero-load sets never set a `heaviest` (a loaded exercise logged at 0 is a
 * missing number, not a record), and a session of nothing but warm-ups sets
 * nothing at all.
 */
export function computeRecords(
  exercise: Exercise,
  history: ExerciseSessionHistory[],
): ExerciseRecords {
  const kinds = new Set(recordKindsFor(exercise));
  const out: ExerciseRecords = {};

  for (const { session, sets } of history) {
    const working = workingSets(sets);
    if (!working.length) continue;

    let volume = 0;
    let volumeAt = 0;

    for (const set of working) {
      const load = loadIn(exercise, set);
      const reps = set.reps;
      const at = set.completedAt;
      const entry = (value: number): RecordEntry => ({
        value,
        load,
        reps,
        sessionId: session.id,
        at,
      });

      volume += load * reps;
      if (at > volumeAt) volumeAt = at;

      if (kinds.has('e1rm') && load > 0 && reps >= 1 && reps <= 12) {
        const value = epley1RM(load, reps);
        if (!out.e1rm || value > out.e1rm.value) out.e1rm = entry(value);
      }

      if (kinds.has('heaviest') && load > 0 && reps >= 1) {
        const best = out.heaviest;
        // Equal load with more reps is the better set, so it takes the record.
        if (!best || load > best.value || (load === best.value && reps > (best.reps ?? 0))) {
          out.heaviest = entry(load);
        }
      }

      if (kinds.has('mostReps') && reps > 0) {
        if (!out.mostReps || reps > out.mostReps.value) out.mostReps = entry(reps);
      }

      if (kinds.has('longest') && reps > 0) {
        if (!out.longest || reps > out.longest.value) out.longest = entry(reps);
      }

      // Conditioning: lower is better, so this is the one minimum here.
      if (kinds.has('bestTime') && reps > 0) {
        if (!out.bestTime || reps < out.bestTime.value) out.bestTime = entry(reps);
      }
    }

    if (kinds.has('bestVolume') && volume > 0) {
      if (!out.bestVolume || volume > out.bestVolume.value) {
        out.bestVolume = { value: volume, sessionId: session.id, at: volumeAt };
      }
    }
  }

  return out;
}

/**
 * Which records this set just beat, given the records held *before* it. Empty
 * when it beat nothing — and empty for a warm-up, whatever the numbers say.
 *
 * A kind with no stored record is never "beaten": with `records` computed from
 * the history before this session, that is what keeps the first session of an
 * exercise from flagging every set (see the note at the top of this file).
 */
export function setBeats(
  exercise: Exercise,
  records: ExerciseRecords,
  set: SetLog,
): SetRecordKind[] {
  if (set.kind === 'warmup') return [];

  const kinds = new Set(recordKindsFor(exercise));
  const load = loadIn(exercise, set);
  const reps = set.reps;
  const out: SetRecordKind[] = [];

  const e1rm = records.e1rm;
  if (kinds.has('e1rm') && e1rm && load > 0 && reps >= 1 && reps <= 12) {
    if (epley1RM(load, reps) > e1rm.value) out.push('e1rm');
  }

  const heaviest = records.heaviest;
  if (kinds.has('heaviest') && heaviest && load > 0 && reps >= 1) {
    if (load > heaviest.value || (load === heaviest.value && reps > (heaviest.reps ?? 0))) {
      out.push('heaviest');
    }
  }

  const mostReps = records.mostReps;
  if (kinds.has('mostReps') && mostReps && reps > mostReps.value) out.push('mostReps');

  const longest = records.longest;
  if (kinds.has('longest') && longest && reps > longest.value) out.push('longest');

  const bestTime = records.bestTime;
  if (kinds.has('bestTime') && bestTime && reps > 0 && reps < bestTime.value) {
    out.push('bestTime');
  }

  return out;
}

/**
 * A record as one line of plain text, in the exercise's own denomination:
 * "117 kg e1RM (100 × 5)", "100 kg × 5", "22 reps", "60 s", "4:05", "2,400 kg".
 * The estimated 1RM is rounded to a whole unit — it is an estimate, and the
 * set it came from is right there in brackets.
 */
export function formatRecord(
  exercise: Exercise,
  kind: RecordKind,
  entry: RecordEntry,
): string {
  const suffix = isLoaded(exercise) ? ` ${formatMassUnit(exercise)}` : '';
  switch (kind) {
    case 'e1rm': {
      const from =
        entry.load !== undefined && entry.reps !== undefined
          ? ` (${formatNumber(entry.load)} × ${entry.reps})`
          : '';
      return `${formatNumber(Math.round(entry.value))}${suffix} e1RM${from}`;
    }
    case 'heaviest':
      return `${formatNumber(entry.value)}${suffix}${
        entry.reps === undefined ? '' : ` × ${entry.reps}`
      }`;
    case 'mostReps':
      return `${formatNumber(entry.value)} rep${entry.value === 1 ? '' : 's'}`;
    case 'longest':
      return `${formatNumber(entry.value)} s`;
    case 'bestTime':
      return formatDuration(entry.value);
    case 'bestVolume':
      // Volume stays in the exercise's own numbers (per-side loads are not
      // doubled), so it says kg / lb rather than "kg/hand".
      return `${Math.round(entry.value).toLocaleString('en-GB')} ${massLabel(
        exerciseMassUnit(exercise),
      )}`;
  }
}
