import type { SetLog } from '../db/types';
import { workingSets } from './sets';
import { setMassUnit, toKg } from './units';

/** Heaviest load logged across the given working sets (0 when there are none). */
export function topSetLoad(sets: SetLog[]): number {
  return workingSets(sets).reduce((max, s) => (s.load > max ? s.load : max), 0);
}

/**
 * Sum of load x reps over the working sets. Raw numbers only: `kg_side` loads
 * are NOT doubled and pounds are NOT converted, so a per-hand exercise's volume
 * is comparable to itself over time, not to a barbell lift. Use
 * `totalVolumeKg` for a total that spans exercises.
 */
export function totalVolume(sets: SetLog[]): number {
  return workingSets(sets).reduce((sum, s) => sum + s.load * s.reps, 0);
}

/**
 * Sum of load x reps over the working sets, with each set's load converted to
 * kilograms via its own `massUnit`. This is the honest number when the sets
 * come from several exercises — a session total, say.
 */
export function totalVolumeKg(sets: SetLog[]): number {
  return workingSets(sets).reduce(
    (sum, s) => sum + toKg(s.load, setMassUnit(s)) * s.reps,
    0,
  );
}

/** Sum of the `reps` field over working sets (reps, seconds or laps). */
export function totalReps(sets: SetLog[]): number {
  return workingSets(sets).reduce((sum, s) => sum + s.reps, 0);
}

/** Mean load across working sets, 0 when empty. */
export function averageLoad(sets: SetLog[]): number {
  const working = workingSets(sets);
  if (!working.length) return 0;
  return working.reduce((sum, s) => sum + s.load, 0) / working.length;
}

/** Number of working sets logged. */
export function setCount(sets: SetLog[]): number {
  return workingSets(sets).length;
}
