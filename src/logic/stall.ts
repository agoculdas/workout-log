import type { Exercise, SetLog } from '../db/types';
import { exerciseScheme } from './progression';
import { workingSets } from './sets';
import { topSetLoad, totalReps } from './volume';

/**
 * Whether the stall rule means anything for this exercise.
 *
 * `isStalled` compares *total reps*, so anything scored on the clock reads
 * backwards: a rowing time that keeps dropping is an improvement, and would be
 * called a regression twice over. Conditioning items and anything running the
 * `best-time` scheme therefore never get the marker — the same rule in Session
 * and on the exercise's own screen.
 */
export function stallApplies(exercise: Pick<Exercise, 'type' | 'scheme'>): boolean {
  return exercise.type !== 'conditioning' && exerciseScheme(exercise) !== 'best-time';
}

/**
 * "Stalled" = regressed two sessions in a row: each of the two most recent
 * sessions did fewer total reps than the session before it, at the same load
 * or lighter. Needs at least three sessions with sets; anything less is false.
 *
 * @param history per-session sets, oldest to newest (see `getExerciseHistory`).
 */
export function isStalled(history: SetLog[][]): boolean {
  const sessions = history.map(workingSets).filter((sets) => sets.length > 0);
  if (sessions.length < 3) return false;

  const [a, b, c] = sessions.slice(-3) as [SetLog[], SetLog[], SetLog[]];
  return regressed(b, a) && regressed(c, b);
}

/** True when `later` did fewer total reps than `earlier` at the same or a lower load. */
function regressed(later: SetLog[], earlier: SetLog[]): boolean {
  return (
    totalReps(later) < totalReps(earlier) && topSetLoad(later) <= topSetLoad(earlier)
  );
}

/** How many sessions in a row (from the newest) regressed. Useful for UI copy. */
export function regressionStreak(history: SetLog[][]): number {
  const sessions = history.map(workingSets).filter((sets) => sets.length > 0);
  let streak = 0;
  for (let i = sessions.length - 1; i > 0; i--) {
    if (regressed(sessions[i]!, sessions[i - 1]!)) streak++;
    else break;
  }
  return streak;
}
