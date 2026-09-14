/**
 * Reading the weight log at a point in time.
 *
 * Entries are one per local calendar day (`BodyweightEntry.date` is
 * `YYYY-MM-DD`), so "what did I weigh when I logged that session" is the
 * latest entry *on or before* that session's day. Pure: no Dexie, no DOM.
 */
import type { BodyweightEntry } from '../db/types';

/** Local calendar date as YYYY-MM-DD — the shape `addBodyweight` stores. */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** True for a well-formed `YYYY-MM-DD`. Anything else is ignored everywhere. */
function isISODate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

/**
 * The weight in kilograms as of `ts` (epoch ms): the most recent entry dated
 * on or before that day. `undefined` when nothing was logged by then — a
 * session from before you started weighing yourself gets no number rather than
 * a guess, and never a later weight read backwards onto it.
 */
export function bodyweightAt(
  entries: readonly BodyweightEntry[],
  ts: number,
): number | undefined {
  if (!Number.isFinite(ts)) return undefined;
  const on = toISODate(new Date(ts));
  let best: BodyweightEntry | undefined;
  for (const entry of entries) {
    if (!isISODate(entry.date) || !Number.isFinite(entry.kg)) continue;
    if (entry.date > on) continue;
    if (!best || entry.date > best.date) best = entry;
  }
  return best?.kg;
}
