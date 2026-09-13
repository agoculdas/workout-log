/**
 * Warm-up row bookkeeping for the Session screen.
 *
 * Warm-ups live at *negative* set indices (−1, −2, …): they can never collide
 * with the working sets (0…n−1), and `setIndex` ordering puts them ahead of
 * the working sets everywhere the database is read back. The label is derived
 * from the index rather than from the position in a list, so removing W1 never
 * renumbers W2 out from under a row that is already logged.
 */
import { roundToStep } from '../../logic/units';

/** Rest after a warm-up is never shorter than this, in seconds. */
export const MIN_WARMUP_REST = 30;

/** The index a newly appended warm-up row takes: −1, then −2, then −3. */
export function nextWarmupIndex(existing: number[]): number {
  const used = existing.filter((i) => i < 0);
  return used.length ? Math.min(...used) - 1 : -1;
}

/**
 * Display order for warm-up rows: the first one added (−1) sits on top, so
 * the list reads W1, W2, … downwards into the working sets. Duplicates and
 * any working index passed in are dropped.
 */
export function sortWarmupIndices(indices: number[]): number[] {
  return [...new Set(indices.filter((i) => i < 0))].sort((a, b) => b - a);
}

/** "W1" for −1, "W2" for −2. */
export function warmupLabel(setIndex: number): string {
  return `W${Math.abs(setIndex)}`;
}

/**
 * The load a fresh warm-up row is pre-filled with: half the working
 * suggestion, snapped to the exercise's own step. Nothing to halve (no
 * history, bodyweight, band) pre-fills nothing.
 */
export function warmupLoad(
  workingLoad: number | null | undefined,
  step: number,
): number | null {
  if (workingLoad === null || workingLoad === undefined) return null;
  if (!(workingLoad > 0)) return null;
  const rounded = roundToStep(workingLoad / 2, step);
  return rounded > 0 ? rounded : null;
}

/** Warm-ups rest for half as long as the working sets, floored at 30 s. */
export function warmupRest(rest: number): number {
  if (!Number.isFinite(rest) || rest <= 0) return MIN_WARMUP_REST;
  return Math.max(MIN_WARMUP_REST, Math.round(rest / 2));
}
