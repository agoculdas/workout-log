import type { SetLog } from '../db/types';

/** Heaviest load logged across the given sets (0 when there are none). */
export function topSetLoad(sets: SetLog[]): number {
  return sets.reduce((max, s) => (s.load > max ? s.load : max), 0);
}

/**
 * Sum of load x reps. Raw numbers only: `kg_side` loads are NOT doubled, so a
 * per-hand exercise's volume is comparable to itself over time, not to a
 * barbell lift.
 */
export function totalVolume(sets: SetLog[]): number {
  return sets.reduce((sum, s) => sum + s.load * s.reps, 0);
}

/** Sum of the `reps` field (reps, seconds or laps depending on the exercise). */
export function totalReps(sets: SetLog[]): number {
  return sets.reduce((sum, s) => sum + s.reps, 0);
}

/** Mean load across sets, 0 when empty. */
export function averageLoad(sets: SetLog[]): number {
  if (!sets.length) return 0;
  return sets.reduce((sum, s) => sum + s.load, 0) / sets.length;
}

/** Number of sets logged. */
export function setCount(sets: SetLog[]): number {
  return sets.length;
}
