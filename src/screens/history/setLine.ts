import type { Exercise, SetLog } from '../../db/types';
import { formatDuration, formatLoad, formatNumber } from '../../logic/format';
import { warmupSets, workingSets } from '../../logic/sets';
import { setMassUnit } from '../../logic/units';

/**
 * One logged set spelled out: "70 kg × 10 reps", "45s", "30 lb/hand × 2 laps".
 * The load is read in the denomination the set was *logged* in, not the one
 * the exercise carries today — re-marking a machine never rewrites history.
 * "To failure" is appended as a plain fact; nothing reads it back.
 */
export function formatSetLine(exercise: Exercise, set: SetLog): string {
  const repPart =
    exercise.measure === 'seconds'
      ? formatDuration(set.reps)
      : exercise.measure === 'laps'
        ? `${formatNumber(set.reps)} lap${set.reps === 1 ? '' : 's'}`
        : `${formatNumber(set.reps)} reps`;
  const failure = set.toFailure ? ' · to failure' : '';

  if (exercise.unit === 'none') return `${repPart}${failure}`;
  if (exercise.unit === 'bodyweight' && set.load === 0) return `BW × ${repPart}${failure}`;
  const asLogged = { ...exercise, massUnit: setMassUnit(set) };
  return `${formatLoad(asLogged, set.load)} × ${repPart}${failure}`;
}

/** One row of a session's set breakdown. */
export interface SetLine {
  set: SetLog;
  warmup: boolean;
  /** 1-based position within its own kind. */
  index: number;
}

/**
 * Warm-ups first, then the working sets, each numbered within its own kind —
 * so "set 3" always means the third set that counted, whatever came before it.
 */
export function orderedSetLines(sets: SetLog[]): SetLine[] {
  return [
    // Warm-ups use negative setIndex (-1 = W1, -2 = W2): sort descending so W1 comes first.
    ...[...warmupSets(sets)]
      .sort((a, b) => b.setIndex - a.setIndex)
      .map((set, i) => ({ set, warmup: true, index: i + 1 })),
    ...workingSets(sets).map((set, i) => ({ set, warmup: false, index: i + 1 })),
  ];
}

/** "set 3" / "warm-up 1" — what the edit sheet's title calls this row. */
export function setLineLabel(line: SetLine): string {
  return line.warmup ? `warm-up ${line.index}` : `set ${line.index}`;
}
