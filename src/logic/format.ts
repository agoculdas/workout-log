import type { Exercise, SetLog } from '../db/types';
import { topSetLoad } from './volume';

/** 2.5 -> "2.5", 70 -> "70", 70.0 -> "70". */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/** 252 -> "4:12", 45 -> "45s", 3600 -> "60:00". */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** The rep target as text: "8–10" for a range, "12" for a fixed number. */
export function formatRepTarget(exercise: Exercise): string {
  if (exercise.measure === 'seconds') {
    return exercise.repMin === exercise.repMax
      ? `${exercise.repMin}s`
      : `${exercise.repMin}–${exercise.repMax}s`;
  }
  return exercise.repMin === exercise.repMax
    ? String(exercise.repMin)
    : `${exercise.repMin}–${exercise.repMax}`;
}

/** "4 × 8–10 each" — the planned prescription, before anything is logged. */
export function formatPrescription(exercise: Exercise): string {
  if (exercise.type === 'conditioning') return exercise.name.includes('km') ? 'log your time' : 'log it';
  if (exercise.measure === 'laps') {
    return `${exercise.sets} lap${exercise.sets === 1 ? '' : 's'}`;
  }
  const each = exercise.perSide ? ' each' : '';
  return `${exercise.sets} × ${formatRepTarget(exercise)}${each}`;
}

/**
 * A load with its unit suffix:
 * kg_side -> "70 kg/hand", kg_total -> "70 kg", band -> "band",
 * bodyweight -> "BW" (or "BW +10 kg"), none -> "—".
 */
export function formatLoad(exercise: Exercise, load: number): string {
  switch (exercise.unit) {
    case 'kg_side':
      return `${formatNumber(load)} kg/hand`;
    case 'kg_total':
      return `${formatNumber(load)} kg`;
    case 'band':
      return load ? `band ${formatNumber(load)}` : 'band';
    case 'bodyweight':
      return load ? `BW +${formatNumber(load)} kg` : 'BW';
    case 'none':
      return '—';
  }
}

/** Pulls "1 km" / "500 m" out of an exercise name, for conditioning summaries. */
function distanceFromName(name: string): string | undefined {
  const match = /(\d+(?:\.\d+)?)\s*(km|m|mi|miles?)\b/i.exec(name);
  return match ? `${match[1]} ${match[2]!.toLowerCase()}` : undefined;
}

/**
 * One-line summary of what was logged, e.g.
 * "4×8 @ 70", "4×8–10 @ 70" (mixed reps), "3×45s", "3 laps @ 30", "1 km in 4:12".
 * Returns "—" when nothing was logged.
 */
export function formatSetSummary(exercise: Exercise, sets: SetLog[]): string {
  if (!sets.length) return '—';

  if (exercise.type === 'conditioning' && exercise.measure === 'seconds') {
    const best = sets.reduce((s, x) => (x.reps > 0 && (s === 0 || x.reps < s) ? x.reps : s), 0);
    const time = formatDuration(best || sets[0]!.reps);
    const distance = distanceFromName(exercise.name);
    return distance ? `${distance} in ${time}` : time;
  }

  const count = sets.length;
  const load = topSetLoad(sets);
  const loadPart =
    exercise.unit === 'bodyweight' || exercise.unit === 'none' || load === 0
      ? ''
      : ` @ ${formatNumber(load)}`;

  if (exercise.measure === 'laps') {
    const laps = sets.reduce((sum, s) => sum + s.reps, 0);
    return `${laps} lap${laps === 1 ? '' : 's'}${loadPart}`;
  }

  const reps = sets.map((s) => s.reps);
  const min = Math.min(...reps);
  const max = Math.max(...reps);
  const repPart = min === max ? `${min}` : `${min}–${max}`;
  const unitSuffix = exercise.measure === 'seconds' ? 's' : '';

  return `${count}×${repPart}${unitSuffix}${loadPart}`;
}

/** "last: 4×8 @ 70" helper for the session screen. */
export function formatLastSession(exercise: Exercise, sets: SetLog[] | undefined): string {
  if (!sets || !sets.length) return 'last: —';
  return `last: ${formatSetSummary(exercise, sets)}`;
}

/** "12 Mar" / "12 Mar 2024" for history lists. */
export function formatDate(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}
