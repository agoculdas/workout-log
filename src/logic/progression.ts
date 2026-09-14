import type { Exercise, ExerciseOverride, ProgressionScheme, SetLog } from '../db/types';
import { formatDuration } from './format';
import { workingSets } from './sets';
import { exerciseMassUnit, massLabel, roundToStep } from './units';

export interface LoadSuggestion {
  /** Suggested load in the exercise's unit. 0 when there is nothing to load. */
  load: number;
  /** Pre-filled reps / seconds / laps target. */
  reps: number;
  /** Short human explanation, shown under the field. Never empty. */
  reason: string;
  /** True when the suggestion is an increase over last session. */
  progressed: boolean;
}

/** Extra facts `suggestLoad` cannot work out from the last session alone. */
export interface SuggestOptions {
  /**
   * The best (lowest) time logged for a conditioning exercise, in seconds —
   * `getExerciseRecords(id).bestTime?.value`. A fact, and only ever used to
   * pre-fill the number you are trying to beat.
   */
  bestTime?: number;
  /**
   * The hand-picked stall answer, when one is standing. Defaults to the
   * exercise's own `override`.
   */
  override?: ExerciseOverride;
}

/**
 * The scheme an exercise runs on: its own when it names one, otherwise the
 * default for its type — `best-time` for conditioning, `double` for the rest.
 */
export function exerciseScheme(
  exercise: Pick<Exercise, 'scheme' | 'type'>,
): ProgressionScheme {
  if (exercise.scheme) return exercise.scheme;
  return exercise.type === 'conditioning' ? 'best-time' : 'double';
}

/**
 * The pre-filled rep target: the bottom of the range for ranges (you have to
 * climb to the top before the load moves), or the fixed number.
 */
export function targetReps(exercise: Exercise): number {
  return exercise.repMin;
}

/**
 * The load "Deload 10%" drops to: a tenth off, snapped to the exercise's own
 * step (2.5 when it has none). Pure, so the sheet stays a set of buttons.
 */
export function deloadLoad(
  exercise: Pick<Exercise, 'increment'>,
  lastLoad: number,
): number {
  return roundToStep(lastLoad * 0.9, exercise.increment || 2.5);
}

/**
 * Keeps only the working sets belonging to the newest session present in the
 * array. Warm-ups are dropped before anything else is decided.
 */
export function setsFromLastSession(input: SetLog[]): SetLog[] {
  const sets = workingSets(input);
  if (sets.length === 0) return [];
  let newest = sets[0]!;
  for (const set of sets) if (set.completedAt > newest.completedAt) newest = set;
  return sets
    .filter((s) => s.sessionId === newest.sessionId)
    .slice()
    .sort((a, b) => a.setIndex - b.setIndex);
}

/** Heaviest load in the array (0 when empty). */
function heaviest(sets: SetLog[]): number {
  return sets.reduce((max, s) => (s.load > max ? s.load : max), 0);
}

function formatKg(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/**
 * The progression rule, per the exercise's scheme (see `exerciseScheme`).
 *
 * - A standing `override` wins over everything: it is what you chose by hand,
 *   and it never counts as progress.
 * - No history: the exercise's `startLoad` when the programme names one,
 *   otherwise a blank load (0). Either way, the rep target.
 * - `double` (the default): if the last logged session covered every planned
 *   set and each one hit the *top* of the rep range at one load, suggest last
 *   load + increment. Otherwise repeat.
 * - `linear`: the same, but the bar is the *bottom* of the range.
 * - `none`: repeat the last load, always. Just tracking.
 * - `best-time`: load 0, reps pre-filled with the best time so far (or the
 *   last one when no record is passed in).
 * - increment 0 (band / bodyweight / none): repeat, just track reps.
 *
 * `lastSets` should come from `getLastSessionSetsForExercise`. Sets belonging
 * to an older session are ignored if several sessions are passed in, and so
 * are warm-ups. The increment is applied as-is: it is already in the
 * exercise's own `massUnit`. Set facts (`toFailure`) are never read.
 */
export function suggestLoad(
  exercise: Exercise,
  lastSets: SetLog[] | undefined,
  opts?: SuggestOptions,
): LoadSuggestion {
  const sets = setsFromLastSession(lastSets ?? []);
  const scheme = exerciseScheme(exercise);
  const label = massLabel(exerciseMassUnit(exercise));
  const lastLoad = heaviest(sets);

  const override = opts?.override ?? exercise.override;
  if (override) {
    const off = lastLoad > 0 ? lastLoad : override.load;
    const reason = () => {
      switch (override.kind) {
        case 'deload':
          return `Deload — 10% off ${formatKg(off)} ${label}.`;
        case 'bottom':
          return `Back to the bottom of the range at ${formatKg(override.load)} ${label}.`;
        case 'manual':
          return `Set in Programme — ${formatKg(override.load)} ${label}.`;
      }
    };
    return {
      load: override.load,
      reps: override.reps,
      reason: reason(),
      progressed: false,
    };
  }

  const lastReps = sets.length ? sets[sets.length - 1]!.reps : 0;

  if (scheme === 'best-time') {
    const best = opts?.bestTime;
    if (best !== undefined && best > 0) {
      return {
        load: 0,
        reps: best,
        reason: `Best ${formatDuration(best)} — try to beat it.`,
        progressed: false,
      };
    }
    return {
      load: 0,
      reps: lastReps,
      reason: sets.length ? 'Beat your last time.' : 'No history yet — log your time.',
      progressed: false,
    };
  }

  // Conditioning on any other scheme still pre-fills a time, not a rep target.
  const target = exercise.type === 'conditioning' ? lastReps : targetReps(exercise);

  if (sets.length === 0) {
    // What the programme says you start on. A number you typed is a decision,
    // so it pre-fills; once a session has been logged the history speaks and
    // this is never read again.
    const start = exercise.startLoad;
    if (exercise.type !== 'conditioning' && start !== undefined && start > 0) {
      return {
        load: start,
        reps: target,
        reason: 'Starting load from your programme.',
        progressed: false,
      };
    }
    return {
      load: 0,
      reps: target,
      reason:
        exercise.type === 'conditioning'
          ? 'No history yet — log your time.'
          : 'No history yet — enter what you lift.',
      progressed: false,
    };
  }

  if (scheme === 'none') {
    return { load: lastLoad, reps: target, reason: 'Tracking only.', progressed: false };
  }

  if (exercise.increment === 0) {
    const unitLabel = exercise.unit === 'band' ? 'Band' : 'Bodyweight';
    return {
      load: lastLoad,
      reps: target,
      reason: `${unitLabel} — track reps, no load step.`,
      progressed: false,
    };
  }

  // Double progression clears the top of the range, linear the bottom.
  const bar = scheme === 'linear' ? exercise.repMin : exercise.repMax;
  const coveredAllSets = sets.length >= exercise.sets;
  const allAtBar = sets.every((s) => s.reps >= bar);
  const sameLoadThroughout = sets.every((s) => s.load === lastLoad);

  if (coveredAllSets && allAtBar && sameLoadThroughout) {
    const hit = scheme === 'linear' ? `at least ${bar}` : String(bar);
    return {
      load: lastLoad + exercise.increment,
      reps: target,
      reason: `All ${exercise.sets} sets hit ${hit} — add ${formatKg(
        exercise.increment,
      )} ${label}.`,
      progressed: true,
    };
  }

  const need = scheme === 'linear' ? `at least ${bar}` : String(bar);
  const reason = coveredAllSets
    ? `Repeat ${formatKg(lastLoad)} — hit ${need} on every set to add weight.`
    : `Repeat ${formatKg(lastLoad)} — finish all ${exercise.sets} sets first.`;

  return { load: lastLoad, reps: target, reason, progressed: false };
}
