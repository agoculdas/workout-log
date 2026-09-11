/** Minimum horizontal travel, in px, before a drag counts as a page turn. */
export const SWIPE_THRESHOLD = 60;

/**
 * How much more horizontal than vertical a drag has to be before we treat it
 * as a swipe. Keeps a slightly-slanted scroll from flipping the exercise.
 */
export const SWIPE_AXIS_RATIO = 1.2;

export type SwipeResult = 'prev' | 'next' | null;

/**
 * Classify a pointer drag.
 *
 * Dragging left (negative dx) moves forward, the way pages turn. `null` means
 * "not a swipe" — too short, or vertical enough that the user was scrolling.
 */
export function resolveSwipe(
  dx: number,
  dy: number,
  threshold = SWIPE_THRESHOLD,
): SwipeResult {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (Math.abs(dx) < threshold) return null;
  if (Math.abs(dx) <= Math.abs(dy) * SWIPE_AXIS_RATIO) return null;
  return dx < 0 ? 'next' : 'prev';
}
