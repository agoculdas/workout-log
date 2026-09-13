/**
 * What a programme day *is*, derived from its split tags.
 *
 * Days stopped being "lower" or "upper" in Dexie v3 — a day carries the same
 * `SplitTag` vocabulary the exercise library uses, and everything that used to
 * read `template.kind` reads these helpers instead. Pure: no Dexie, no DOM.
 */
import type { Programme, SplitTag, Template } from '../db/types';

/** Just the tags — callers pass a whole `Template` or a bare `{ tags }`. */
type Tagged = Pick<Template, 'tags'>;

function has(t: Tagged | undefined, tag: SplitTag): boolean {
  return Boolean(t?.tags?.includes(tag));
}

/** A leg day by any name: tagged `lower` or `legs`. */
export function isLowerDay(t: Tagged): boolean {
  return has(t, 'lower') || has(t, 'legs');
}

/** Tagged `upper` — or one of the upper-body body-part tags. */
export function isUpperDay(t: Tagged): boolean {
  return (
    has(t, 'upper') ||
    has(t, 'push') ||
    has(t, 'pull') ||
    has(t, 'chest') ||
    has(t, 'back') ||
    has(t, 'shoulders') ||
    has(t, 'arms')
  );
}

/** The coarse labels a day can carry. `'Day'` is the nothing-matched fallback. */
export type DayKindLabel =
  | 'Lower'
  | 'Upper'
  | 'Push'
  | 'Pull'
  | 'Legs'
  | 'Full body'
  | 'Day';

/**
 * A one-word name for the day, for chips and the rotation strip.
 *
 * Priority, first match wins: Full body → Push → Pull → Legs → Lower → Upper →
 * "Day". A day that is both upper and lower is "Full body"; push and pull beat
 * the upper/lower pair (a PPL push day is tagged `['upper','push']` and should
 * read "Push", not "Upper"); `legs` beats `lower`, so a PPL or body-part legs
 * day (`['lower','legs']`) reads "Legs" while a plain upper/lower leg day
 * (`['lower']`) reads "Lower". That is why the stock programme and the
 * `upper_lower_4` preset tag their lower days `['lower']` and nothing else.
 */
export function dayKindLabel(t: Tagged): DayKindLabel {
  if (has(t, 'upper') && (has(t, 'lower') || has(t, 'legs'))) return 'Full body';
  if (has(t, 'push')) return 'Push';
  if (has(t, 'pull')) return 'Pull';
  if (has(t, 'legs')) return 'Legs';
  if (has(t, 'lower')) return 'Lower';
  if (has(t, 'upper')) return 'Upper';
  return 'Day';
}

/**
 * Tags that say nothing about which half of the body is fresh: abs and
 * conditioning get trained on whichever day you like, so they never clash.
 */
const CLASH_IGNORED: readonly SplitTag[] = ['cardio', 'core'];

/** The tags that decide what kind of day this is, in no particular order. */
function clashTags(tags: SplitTag[] | undefined): Set<SplitTag> {
  return new Set((tags ?? []).filter((tag) => !CLASH_IGNORED.includes(tag)));
}

/**
 * Are these two days *the same kind of day*? True only when their tag sets are
 * equal once `cardio` and `core` are dropped; two days with no tags at all
 * never clash. This is the generalised "no lower after lower" rule.
 *
 * Equality rather than overlap, deliberately. Push (`['upper','push']`) and
 * Pull (`['upper','pull']`) share `upper` but train nothing in common, and
 * running them on consecutive evenings — under 24 h apart — must not make the
 * picker skip one. Lower A and Lower B (both `['lower']`) do clash, which is
 * the rule's whole point, and so do two Legs days (both `['lower','legs']`).
 * A PPL Legs day and a stock Lower day do *not*, since their tag sets differ —
 * acceptable, because they belong to different programmes and you are only
 * ever running one. Two identically tagged full-body days clash too; the
 * all-clash fallback in `pickNextSession` means the rotation simply wins there.
 */
export function tagsClash(a: SplitTag[] | undefined, b: SplitTag[] | undefined): boolean {
  const left = clashTags(a);
  const right = clashTags(b);
  if (!left.size || !right.size) return false;
  if (left.size !== right.size) return false;
  for (const tag of left) if (!right.has(tag)) return false;
  return true;
}

/** The one- or two-letter abbreviation the rotation strip shows for a day. */
export function dayShortLabel(t: Tagged): string {
  const label = dayKindLabel(t);
  if (label === 'Full body') return 'FB';
  if (label === 'Pull') return 'Pu'; // 'P' alone would collide with Push
  return label.slice(0, 1);
}

/**
 * The week shape, e.g. `"L · U · rest · L · U · rest · rest"`. Slots whose
 * template is missing or archived read as rest, exactly as `pickNextSession`
 * treats them.
 */
export function rotationShape(
  programme: Pick<Programme, 'rotation'> | undefined,
  templates: readonly Template[],
): string {
  const byId = new Map(templates.map((t) => [t.id, t]));
  return (programme?.rotation ?? [])
    .map((slot) => {
      if ('rest' in slot) return 'rest';
      const template = byId.get(slot.templateId);
      return template && !template.archived ? dayShortLabel(template) : 'rest';
    })
    .join(' · ');
}
