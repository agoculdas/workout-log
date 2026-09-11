import type { SetLog } from '../db/types';
import { topSetLoad, totalReps } from './volume';

/**
 * "Stalled" = regressed two sessions in a row: each of the two most recent
 * sessions did fewer total reps than the session before it, at the same load
 * or lighter. Needs at least three sessions with sets; anything less is false.
 *
 * @param history per-session sets, oldest to newest (see `getExerciseHistory`).
 */
export function isStalled(history: SetLog[][]): boolean {
  const sessions = history.filter((sets) => sets.length > 0);
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
  const sessions = history.filter((sets) => sets.length > 0);
  let streak = 0;
  for (let i = sessions.length - 1; i > 0; i--) {
    if (regressed(sessions[i]!, sessions[i - 1]!)) streak++;
    else break;
  }
  return streak;
}
