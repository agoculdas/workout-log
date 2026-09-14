import type { Exercise, SetLog } from '../db/types';
import { workingSets } from './sets';
import { exerciseMassUnit, massLabel } from './units';
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

/**
 * A running clock: "07:41", and "1:07:41" once it passes the hour. Always two
 * digits on the minutes and seconds so the header does not jiggle as it ticks
 * — unlike `formatDuration`, which is for reading a finished number.
 */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const s = String(total % 60).padStart(2, '0');
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${String(m).padStart(2, '0')}:${s}`;
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
 * The suffix a load field shows for this exercise: "kg", "lb", "kg/hand",
 * "lb/hand", "band", "BW" or "—". Reads the exercise's own denomination.
 */
export function formatMassUnit(
  exercise: Pick<Exercise, 'unit' | 'massUnit'>,
): 'kg' | 'lb' | 'kg/hand' | 'lb/hand' | 'band' | 'BW' | '—' {
  const label = massLabel(exerciseMassUnit(exercise));
  switch (exercise.unit) {
    case 'kg_side':
      return label === 'lb' ? 'lb/hand' : 'kg/hand';
    case 'kg_total':
      return label;
    case 'band':
      return 'band';
    case 'bodyweight':
      return 'BW';
    case 'none':
      return '—';
  }
}

/**
 * A load with its unit suffix, in the exercise's own denomination:
 * kg_side -> "70 kg/hand" or "30 lb/hand", kg_total -> "70 kg" / "70 lb",
 * band -> "band", bodyweight -> "BW" (or "BW +10 kg"), none -> "—".
 */
export function formatLoad(exercise: Exercise, load: number): string {
  const label = massLabel(exerciseMassUnit(exercise));
  switch (exercise.unit) {
    case 'kg_side':
      return `${formatNumber(load)} ${label}/hand`;
    case 'kg_total':
      return `${formatNumber(load)} ${label}`;
    case 'band':
      return load ? `band ${formatNumber(load)}` : 'band';
    case 'bodyweight':
      return load ? `BW +${formatNumber(load)} ${label}` : 'BW';
    case 'none':
      return '—';
  }
}

/** "1,240 kg" — a session or window total, always in kilograms. */
export function formatVolumeKg(kg: number): string {
  if (!Number.isFinite(kg)) return '0 kg';
  return `${Math.round(kg).toLocaleString('en-GB')} kg`;
}

/** Pulls "1 km" / "500 m" out of an exercise name, for conditioning summaries. */
function distanceFromName(name: string): string | undefined {
  const match = /(\d+(?:\.\d+)?)\s*(km|m|mi|miles?)\b/i.exec(name);
  return match ? `${match[1]} ${match[2]!.toLowerCase()}` : undefined;
}

/**
 * One-line summary of the working sets, e.g. "4×8 @ 70 kg",
 * "4×8–10 @ 70 kg" (mixed reps), "3×45s", "3 laps @ 30 lb", "1 km in 4:12".
 * Warm-ups are ignored; returns "—" when nothing working was logged.
 */
export function formatSetSummary(exercise: Exercise, input: SetLog[]): string {
  const sets = workingSets(input);
  if (!sets.length) return '—';

  if (exercise.type === 'conditioning' && exercise.measure === 'seconds') {
    const best = sets.reduce((s, x) => (x.reps > 0 && (s === 0 || x.reps < s) ? x.reps : s), 0);
    const time = formatDuration(best || sets[0]!.reps);
    const distance = distanceFromName(exercise.name);
    return distance ? `${distance} in ${time}` : time;
  }

  const count = sets.length;
  const load = topSetLoad(sets);
  // Bands carry no denomination, so their number stays bare.
  const suffix =
    exercise.unit === 'band' ? '' : ` ${massLabel(exerciseMassUnit(exercise))}`;
  const loadPart =
    exercise.unit === 'bodyweight' || exercise.unit === 'none' || load === 0
      ? ''
      : ` @ ${formatNumber(load)}${suffix}`;

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

/** "last: 4×8 @ 70 kg" helper for the session screen. Warm-ups don't count. */
export function formatLastSession(
  exercise: Exercise,
  sets: SetLog[] | undefined,
): string {
  if (!sets || !workingSets(sets).length) return 'last: —';
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
