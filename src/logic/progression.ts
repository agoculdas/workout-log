import type { Exercise, SetLog } from '../db/types';
import { workingSets } from './sets';
import { exerciseMassUnit, massLabel } from './units';

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

/**
 * The pre-filled rep target: the bottom of the range for ranges (you have to
 * climb to the top before the load moves), or the fixed number.
 */
export function targetReps(exercise: Exercise): number {
  return exercise.repMin;
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
 * The progression rule.
 *
 * - No history: blank load (0) and the rep target.
 * - primary / accessory with an increment: if the last logged session covered
 *   every planned set and each one hit the top of the rep range, suggest
 *   last load + increment. Otherwise repeat the same load.
 * - increment 0 (band / bodyweight / none): repeat, just track reps.
 * - conditioning: load 0, reps pre-filled with the last time.
 *
 * `lastSets` should come from `getLastSessionSetsForExercise`. Sets belonging
 * to an older session are ignored if several sessions are passed in, and so
 * are warm-ups. The increment is applied as-is: it is already in the
 * exercise's own `massUnit`. Set facts (`toFailure`) are never read.
 */
export function suggestLoad(
  exercise: Exercise,
  lastSets: SetLog[] | undefined,
): LoadSuggestion {
  const sets = setsFromLastSession(lastSets ?? []);

  if (exercise.type === 'conditioning') {
    const last = sets.length ? sets[sets.length - 1]! : undefined;
    return {
      load: 0,
      reps: last ? last.reps : 0,
      reason: last ? 'Beat your last time.' : 'No history yet — log your time.',
      progressed: false,
    };
  }

  const target = targetReps(exercise);

  if (sets.length === 0) {
    return {
      load: 0,
      reps: target,
      reason: 'No history yet — enter what you lift.',
      progressed: false,
    };
  }

  const lastLoad = heaviest(sets);

  if (exercise.increment === 0) {
    const unitLabel = exercise.unit === 'band' ? 'Band' : 'Bodyweight';
    return {
      load: lastLoad,
      reps: target,
      reason: `${unitLabel} — track reps, no load step.`,
      progressed: false,
    };
  }

  const coveredAllSets = sets.length >= exercise.sets;
  const allAtTop = sets.every((s) => s.reps >= exercise.repMax);
  const sameLoadThroughout = sets.every((s) => s.load === lastLoad);

  if (coveredAllSets && allAtTop && sameLoadThroughout) {
    return {
      load: lastLoad + exercise.increment,
      reps: target,
      reason: `All ${exercise.sets} sets hit ${exercise.repMax} — add ${formatKg(
        exercise.increment,
      )} ${massLabel(exerciseMassUnit(exercise))}.`,
      progressed: true,
    };
  }

  const reason = coveredAllSets
    ? `Repeat ${formatKg(lastLoad)} — hit ${exercise.repMax} on every set to add weight.`
    : `Repeat ${formatKg(lastLoad)} — finish all ${exercise.sets} sets first.`;

  return { load: lastLoad, reps: target, reason, progressed: false };
}
