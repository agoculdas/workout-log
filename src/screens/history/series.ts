/**
 * Pure chart data-shaping for the per-exercise history screen.
 *
 * Nothing here touches the database or React — `ExerciseHistory` feeds it the
 * rows from `getExerciseHistory()` and hands the result to `charts.tsx`.
 */
import type { Exercise, ExerciseSessionHistory, SetLog } from '../../db/types';
import { formatDate } from '../../logic/format';
import { topSetLoad, totalReps, totalVolume } from '../../logic/volume';

/** One point on a line chart: one completed session. */
export interface SeriesPoint {
  sessionId: string;
  /** Epoch ms the session finished (falls back to when it started). */
  t: number;
  /** Short x-axis label, e.g. "12 Mar". */
  label: string;
  value: number;
}

/**
 * Which pair of charts an exercise gets:
 * - `load`  — top set load + volume (anything with a real external load)
 * - `reps`  — total reps + volume is meaningless, so reps only (band / BW / none)
 * - `time`  — a single conditioning time chart, lower is better
 */
export type ChartKind = 'load' | 'reps' | 'time';

export function chartKindFor(exercise: Exercise): ChartKind {
  if (exercise.type === 'conditioning' && exercise.measure === 'seconds') return 'time';
  if (exercise.unit === 'band' || exercise.unit === 'bodyweight' || exercise.unit === 'none') {
    return 'reps';
  }
  return 'load';
}

/**
 * Completed sessions that actually logged something, oldest first.
 * `getExerciseHistory()` includes in-progress sessions, which have no
 * `finishedAt` and would put a half-done point on the end of every chart.
 */
export function completedOnly(
  history: ExerciseSessionHistory[],
): ExerciseSessionHistory[] {
  return history
    .filter((h) => h.session.finishedAt !== undefined && h.sets.length > 0)
    .sort((a, b) => a.session.startedAt - b.session.startedAt);
}

/** Newest first — the order the session list under the charts wants. */
export function newestFirst(
  history: ExerciseSessionHistory[],
): ExerciseSessionHistory[] {
  return [...history].sort((a, b) => b.session.startedAt - a.session.startedAt);
}

/** Timestamp used for a session on the x axis. */
export function sessionTime(h: ExerciseSessionHistory): number {
  return h.session.finishedAt ?? h.session.startedAt;
}

/** Maps completed sessions to points using `value` for the y coordinate. */
export function buildSeries(
  history: ExerciseSessionHistory[],
  value: (sets: SetLog[]) => number,
  now = Date.now(),
): SeriesPoint[] {
  return history.map((h) => {
    const t = sessionTime(h);
    return { sessionId: h.session.id, t, label: formatDate(t, now), value: value(h.sets) };
  });
}

export function loadSeries(
  history: ExerciseSessionHistory[],
  now?: number,
): SeriesPoint[] {
  return buildSeries(history, topSetLoad, now);
}

export function volumeSeries(
  history: ExerciseSessionHistory[],
  now?: number,
): SeriesPoint[] {
  return buildSeries(history, totalVolume, now);
}

export function repsSeries(
  history: ExerciseSessionHistory[],
  now?: number,
): SeriesPoint[] {
  return buildSeries(history, totalReps, now);
}

/** Conditioning: the logged time in seconds (first set). */
export function timeSeries(
  history: ExerciseSessionHistory[],
  now?: number,
): SeriesPoint[] {
  return buildSeries(history, (sets) => sets[0]?.reps ?? 0, now);
}

/** A line needs two points to say anything; below that we show a hint instead. */
export function hasTrend(points: SeriesPoint[]): boolean {
  return points.length >= 2;
}

/**
 * [min, max] padded by 5% so a flat-ish line does not sit on the axis.
 * Returns `undefined` when there is nothing to scale.
 */
export function paddedDomain(points: SeriesPoint[]): [number, number] | undefined {
  if (!points.length) return undefined;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    return [min - pad, max + pad];
  }
  const pad = (max - min) * 0.05;
  return [min - pad, max + pad];
}

/** Newest value minus the one before it, or `undefined` with fewer than 2 points. */
export function lastChange(points: SeriesPoint[]): number | undefined {
  if (points.length < 2) return undefined;
  return points[points.length - 1]!.value - points[points.length - 2]!.value;
}
