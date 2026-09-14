import type { LoadUnit, SetLog } from '../db/types';
import { workingSets } from './sets';
import { setMassUnit, toKg } from './units';

/** How `totalVolumeKg` should read the sets it is handed. */
export interface VolumeOptions {
  /**
   * Your bodyweight in kilograms. Given, a `bodyweight` set counts
   * `(bodyweight + load) x reps`; omitted, it counts only the added load, as
   * it always has. Never inferred — the caller decides whether the option is
   * on and which weigh-in applies.
   */
  bodyweightKg?: number;
  /**
   * Resolves a set's load unit when the row itself does not carry one (every
   * set logged before `SetLog.unit` existed). Usually reads the session
   * snapshot, falling back to the live exercise.
   */
  unitFor?: (set: SetLog) => LoadUnit | undefined;
}

/** The unit a set was logged in: the stamp wins, then whatever the caller knows. */
function setLoadUnit(set: SetLog, opts: VolumeOptions): LoadUnit | undefined {
  return set.unit ?? opts.unitFor?.(set);
}

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
 *
 * With `bodyweightKg`, sets whose unit is `bodyweight` count the body being
 * moved as well: a set of 10 chin-ups at 82 kg is 820 kg, and 10 with a 10 kg
 * belt is 920 kg. Everything else is unaffected, and with the option off the
 * number is exactly what it always was.
 */
export function totalVolumeKg(sets: SetLog[], opts: VolumeOptions = {}): number {
  return workingSets(sets).reduce((sum, s) => {
    const load = toKg(s.load, setMassUnit(s));
    const extra =
      opts.bodyweightKg !== undefined && setLoadUnit(s, opts) === 'bodyweight'
        ? opts.bodyweightKg
        : 0;
    return sum + (load + extra) * s.reps;
  }, 0);
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
