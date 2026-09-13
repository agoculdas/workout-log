/**
 * Pure maths behind the muscle-volume views: week bucketing and the
 * primary/secondary set tally. No Dexie in here — `getMuscleVolume()` in
 * `db/repo.ts` is a thin wrapper that feeds these the rows it read.
 */
import { MUSCLES } from '../db/types';
import type { CatalogEntry, Muscle, MuscleVolumeResult, MuscleVolumeRow, SetLog } from '../db/types';
import { workingSets } from './sets';

/** A set as far as the tally is concerned. */
export interface TallySet {
  sessionId: string;
  exerciseId: string;
  /** Warm-ups (`'warmup'`) are not counted. Absent means a working set. */
  kind?: SetLog['kind'];
}

/** A set as far as bucketing is concerned. */
export interface TimedSet {
  completedAt: number;
}

/** One week's worth of sets: `[start, end)` in local time. */
export interface WeekBucket<T> {
  /** Local midnight on the first day of the week. */
  start: number;
  /** Local midnight on the first day of the *next* week (exclusive). */
  end: number;
  sets: T[];
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Local midnight at the start of the week containing `ts`.
 * `weekStartsOn` is a JS day index: 0 Sunday, 1 Monday (the default).
 */
export function weekStart(ts: number, weekStartsOn = 1): number {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  const back = (date.getDay() - weekStartsOn + 7) % 7;
  date.setDate(date.getDate() - back);
  return date.getTime();
}

/** Local midnight `days` days after `ts`, DST-safe (not `ts + days * DAY`). */
function addDays(ts: number, days: number): number {
  const date = new Date(ts);
  date.setDate(date.getDate() + days);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * The last `weeks` weeks ending with the week containing `now`, oldest first.
 * Every bucket is present even when empty; sets outside the range are dropped.
 */
export function bucketByWeek<T extends TimedSet>(
  sets: T[],
  weeks: number,
  now: number,
  weekStartsOn = 1,
): WeekBucket<T>[] {
  const count = Math.max(0, Math.floor(weeks));
  if (count === 0) return [];
  const current = weekStart(now, weekStartsOn);
  const buckets: WeekBucket<T>[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = addDays(current, -7 * i);
    buckets.push({ start, end: addDays(start, 7), sets: [] });
  }
  const first = buckets[0]!.start;
  const last = buckets[buckets.length - 1]!.end;
  for (const set of sets) {
    const at = set.completedAt;
    if (at < first || at >= last) continue;
    // Weeks are uniform in length apart from DST, so index then verify.
    let index = Math.floor((at - first) / (7 * DAY));
    while (index > 0 && at < buckets[index]!.start) index--;
    while (index < buckets.length - 1 && at >= buckets[index]!.end) index++;
    buckets[index]!.sets.push(set);
  }
  return buckets;
}

/**
 * Share the sets out over the muscles their catalogue entry names: a set
 * counts 1 for each primary muscle and 0.5 for each secondary one. `sets`
 * counts primaries only; `weightedSets` counts both. Sets whose exercise has
 * no catalogue entry are counted in `unlinkedSets` and nowhere else. Warm-ups
 * are dropped before anything is counted, `unlinkedSets` included.
 *
 * Every muscle gets a row, including the ones with nothing in them, in
 * `MUSCLES` order — so a chart can render the whole body without filling gaps.
 */
export function tallyMuscles<T extends TallySet>(
  setLogs: T[],
  resolveEntry: (exerciseId: string) => CatalogEntry | undefined,
): MuscleVolumeResult {
  const sets = new Map<Muscle, number>();
  const weighted = new Map<Muscle, number>();
  const sessions = new Map<Muscle, Set<string>>();
  for (const muscle of MUSCLES) {
    sets.set(muscle, 0);
    weighted.set(muscle, 0);
    sessions.set(muscle, new Set<string>());
  }

  let unlinkedSets = 0;
  for (const log of workingSets(setLogs)) {
    const entry = resolveEntry(log.exerciseId);
    if (!entry) {
      unlinkedSets++;
      continue;
    }
    const primary = new Set(entry.primary ?? []);
    for (const muscle of primary) {
      if (!sets.has(muscle)) continue;
      sets.set(muscle, sets.get(muscle)! + 1);
      weighted.set(muscle, weighted.get(muscle)! + 1);
      sessions.get(muscle)!.add(log.sessionId);
    }
    for (const muscle of new Set(entry.secondary ?? [])) {
      if (!weighted.has(muscle) || primary.has(muscle)) continue;
      weighted.set(muscle, weighted.get(muscle)! + 0.5);
      sessions.get(muscle)!.add(log.sessionId);
    }
  }

  const rows: MuscleVolumeRow[] = MUSCLES.map((muscle) => ({
    muscle,
    sets: sets.get(muscle)!,
    weightedSets: weighted.get(muscle)!,
    sessions: sessions.get(muscle)!.size,
  }));
  return { rows, unlinkedSets };
}
