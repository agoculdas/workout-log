import type { Exercise, SetLog } from '../../db/types';
import { formatDuration, formatLoad, formatNumber } from '../../logic/format';

/** One logged set spelled out: "70 kg × 10 reps", "45s", "30 kg/hand × 2 laps". */
export function formatSetLine(exercise: Exercise, set: SetLog): string {
  const repPart =
    exercise.measure === 'seconds'
      ? formatDuration(set.reps)
      : exercise.measure === 'laps'
        ? `${formatNumber(set.reps)} lap${set.reps === 1 ? '' : 's'}`
        : `${formatNumber(set.reps)} reps`;

  if (exercise.unit === 'none') return repPart;
  if (exercise.unit === 'bodyweight' && set.load === 0) return `BW × ${repPart}`;
  return `${formatLoad(exercise, set.load)} × ${repPart}`;
}
