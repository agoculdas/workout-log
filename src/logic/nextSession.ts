/**
 * Which session to offer next.
 *
 * The rotation is data now: a `Programme` carries an ordered list of slots,
 * each either a day or a rest day, and this walks it. Rest slots are
 * informational — Today shows them and offers the day that follows.
 */
import { tagsClash } from './days';
import type { Programme, Session, Template } from '../db/types';

export type NextSessionPick =
  | {
      kind: 'train';
      templateId: string;
      /** Position in the rotation, or -1 when the rotation is empty. */
      slotIndex: number;
      /**
       * Rest slots the rotation held before this day, now elapsed — e.g. 2
       * for "after 2 rest days". Absent when the day follows straight on, and
       * on the very first session, where no rest was taken. Normal flow: it
       * is never paired with a `reason`.
       */
      restTaken?: number;
      /** Present only when the plain rotation was overridden. */
      reason?: string;
      /** The day that would have come next, when it was skipped. */
      skippedTemplateId?: string;
    }
  | {
      kind: 'rest';
      slotIndex: number;
      /** Which of this run's rest days today is: 1-based, "day 1 of 2". */
      restDay: number;
      /** How many rest slots the rotation holds before the next training day. */
      restTotal: number;
      /** The first training day after this rest slot, if the rotation has one. */
      nextTemplateId?: string;
      nextSlotIndex?: number;
      /** Why `nextTemplateId` is not simply the next day in the rotation. */
      reason?: string;
    };

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 0 = same calendar day, 1 = yesterday, 2 = two days ago, ... */
export function calendarDaysAgo(then: number, now: number): number {
  return Math.round((startOfLocalDay(now) - startOfLocalDay(then)) / DAY_MS);
}

function whenPhrase(then: number, now: number): string {
  const days = calendarDaysAgo(then, now);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/** When a session ended, falling back to when it started. */
function endedAt(session: Session): number {
  return session.finishedAt ?? session.startedAt;
}

/**
 * Where the rotation resumes.
 *
 * The slot after the last completed session's. A session stamped with a
 * `slotIndex` (everything started since programmes landed) resolves exactly;
 * an older one falls back to the first occurrence of its template in the
 * rotation. No history at all starts at slot 0, and an empty rotation has no
 * slots to offer, so it returns -1 for the caller to handle.
 */
export function nextSlotIndex(
  programme: Pick<Programme, 'rotation'> | undefined,
  last: Session | undefined,
): number {
  const rotation = programme?.rotation ?? [];
  if (rotation.length === 0) return -1;
  if (!last) return 0;

  if (typeof last.slotIndex === 'number' && last.slotIndex >= 0) {
    return (last.slotIndex + 1) % rotation.length;
  }

  const found = rotation.findIndex(
    (slot) => !('rest' in slot) && slot.templateId === last.templateId,
  );
  if (found === -1) return 0;
  return (found + 1) % rotation.length;
}

/** The session (within the last 24 h) whose day overlaps this one, if any. */
function findClash(
  day: Template,
  recentCompleted: readonly Session[],
  byId: Map<string, Template>,
  now: number,
): { template: Template; finishedAt: number } | undefined {
  for (const session of recentCompleted) {
    const finishedAt = endedAt(session);
    if (now - finishedAt >= DAY_MS) continue;
    // Sessions from another programme count too — the tags are what matter.
    // A template we cannot resolve tells us nothing, so it never clashes.
    const template = byId.get(session.templateId);
    if (!template) continue;
    if (tagsClash(day.tags, template.tags)) return { template, finishedAt };
  }
  return undefined;
}

/**
 * What to train next.
 *
 * @param programme    the active programme, whose rotation is walked.
 * @param templates    every template that might be referenced — the
 *                     programme's days, plus any other programme's days so
 *                     sessions logged under them still clash-check.
 * @param recentCompleted completed sessions, newest first.
 * @param now          epoch ms, injected so this stays pure and testable.
 *
 * Rest slots elapse on their own. Count the rest slots between here and the
 * next training day (`k`) and how many calendar days have passed since the
 * last session (`d`). Each rest slot is a full calendar day: train Monday,
 * two rest slots → Tuesday is "rest day 1 of 2", Wednesday "2 of 2", Thursday
 * trains. So while `d <= k` the answer is `kind: 'rest'` (the same evening
 * as the session still reads "rest day 1"), carrying the day that follows so
 * Today can offer "train anyway" without a second call. Once `d > k` those
 * rest days count as taken and the training day comes back as a normal
 * `train` pick with `restTaken: k` — no `reason`, because nothing was overridden.
 *
 * Either way the training day gets the clash rule: a day of the *same kind*
 * (`tagsClash`) as something finished in the last 24 h is skipped for the
 * first day in the rotation that is not, with a `reason` saying so. If every
 * day clashes, the rotation wins and nothing is claimed.
 */
export function pickNextSession(
  programme: Programme | undefined,
  templates: readonly Template[],
  recentCompleted: readonly Session[],
  now: number,
): NextSessionPick {
  const byId = new Map(templates.map((t) => [t.id, t]));
  const rotation = programme?.rotation ?? [];

  /** The live day at a rotation slot; `undefined` means "treat as rest". */
  const dayAt = (index: number): Template | undefined => {
    const slot = rotation[index];
    if (!slot || 'rest' in slot) return undefined;
    const template = byId.get(slot.templateId);
    return template && !template.archived ? template : undefined;
  };

  if (rotation.length === 0) {
    const first = templates
      .filter((t) => !t.archived)
      .slice()
      .sort((a, b) => a.order - b.order)[0];
    return first
      ? { kind: 'train', templateId: first.id, slotIndex: -1 }
      : { kind: 'rest', slotIndex: -1, restDay: 0, restTotal: 0 };
  }

  const start = nextSlotIndex(programme, recentCompleted[0]);

  /**
   * The first training slot at or after `from` whose day does not clash,
   * together with the first training slot it passed over (what the plain
   * rotation would have offered) and why.
   */
  const scan = (
    from: number,
  ): {
    slotIndex: number;
    template: Template;
    skipped?: Template;
    reason?: string;
  } | undefined => {
    let firstTraining: { slotIndex: number; template: Template } | undefined;
    let clash: { template: Template; finishedAt: number } | undefined;
    for (let step = 0; step < rotation.length; step++) {
      const index = (from + step) % rotation.length;
      const day = dayAt(index);
      if (!day) continue;
      const hit = findClash(day, recentCompleted, byId, now);
      if (!firstTraining) {
        firstTraining = { slotIndex: index, template: day };
        clash = hit;
      }
      if (hit) continue;
      if (firstTraining.slotIndex === index) return { slotIndex: index, template: day };
      return {
        slotIndex: index,
        template: day,
        skipped: firstTraining.template,
        reason: clash
          ? `You trained ${clash.template.name} ${whenPhrase(clash.finishedAt, now)} — doing ${day.name} instead.`
          : undefined,
      };
    }
    // Every day in the rotation clashes: the rotation wins, silently.
    return firstTraining
      ? { slotIndex: firstTraining.slotIndex, template: firstTraining.template }
      : undefined;
  };

  // How many rest slots stand between here and the next training day. Slots
  // whose day is archived or gone count as rest, same as everywhere else.
  let restTotal = 0;
  while (restTotal < rotation.length && !dayAt((start + restTotal) % rotation.length)) {
    restTotal++;
  }

  const last = recentCompleted[0];
  // No history means no rest to take: the first session is never held back.
  const daysSince = last ? calendarDaysAgo(endedAt(last), now) : restTotal + 1;

  const picked = scan(start);
  if (!picked) {
    // Every slot in the rotation is a rest day. Nothing to count down to, so
    // the run never ends and the day number just stops at the total.
    return {
      kind: 'rest',
      slotIndex: start,
      restDay: Math.min(Math.max(last ? daysSince : 1, 1), rotation.length),
      restTotal: rotation.length,
    };
  }

  // No rest slot between here and the next day → it is simply next (a second
  // session on the same day is the user's call, never a 'rest' state).
  if (restTotal > 0 && daysSince <= restTotal) {
    return {
      kind: 'rest',
      slotIndex: start,
      restDay: Math.min(Math.max(daysSince, 1), restTotal),
      restTotal,
      nextTemplateId: picked.template.id,
      nextSlotIndex: picked.slotIndex,
      ...(picked.reason ? { reason: picked.reason } : {}),
    };
  }

  return {
    kind: 'train',
    templateId: picked.template.id,
    slotIndex: picked.slotIndex,
    ...(restTotal > 0 && last ? { restTaken: restTotal } : {}),
    ...(picked.reason ? { reason: picked.reason } : {}),
    ...(picked.skipped ? { skippedTemplateId: picked.skipped.id } : {}),
  };
}
