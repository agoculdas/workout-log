/**
 * Working sets versus warm-ups. Warm-ups are logged so the session record is
 * complete, but they never feed progression, volume, top sets or the muscle
 * tallies — every one of those filters through `workingSets` first.
 */
import type { SetLog } from '../db/types';

/** The little of a set that says whether it counts. */
export type SetKindish = Pick<SetLog, 'kind'>;

/** Everything that is not a warm-up (rows with no `kind` are working sets). */
export function workingSets<T extends SetKindish>(sets: T[]): T[] {
  return sets.filter((s) => s.kind !== 'warmup');
}

/** Only the warm-ups. */
export function warmupSets<T extends SetKindish>(sets: T[]): T[] {
  return sets.filter((s) => s.kind === 'warmup');
}
