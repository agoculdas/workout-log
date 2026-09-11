import type { Session, Template, TemplateId } from '../db/types';

export interface NextSessionPick {
  templateId: TemplateId;
  /** Present only when the plain rotation was overridden. */
  reason?: string;
  /** The day that would have come next, when it was skipped. */
  skippedTemplateId?: TemplateId;
}

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

/**
 * Which session to offer next.
 *
 * Base rule: the successor of the last completed day in the rotation
 * (lowerA -> upperA -> lowerB -> upperB -> lowerA), or the first template when
 * nothing has been completed yet.
 *
 * Override: never offer a lower day while the last completed session was a
 * lower day finished less than 24 h ago, or on the same calendar day, or
 * yesterday. In that case skip forward to the next upper day and explain why.
 *
 * @param templates all templates (any order; sorted internally by `order`).
 * @param lastCompleted the most recent finished session, if any.
 * @param now epoch ms, injected so this stays pure and testable.
 */
export function pickNextSession(
  templates: Template[],
  lastCompleted: Session | undefined,
  now: number,
): NextSessionPick {
  const cycle = [...templates].sort((a, b) => a.order - b.order);
  if (cycle.length === 0) return { templateId: 'lowerA' };

  const first = cycle[0]!;
  if (!lastCompleted) return { templateId: first.id };

  const lastIndex = cycle.findIndex((t) => t.id === lastCompleted.templateId);
  if (lastIndex === -1) return { templateId: first.id };

  const lastTemplate = cycle[lastIndex]!;
  const candidate = cycle[(lastIndex + 1) % cycle.length]!;

  const finishedAt = lastCompleted.finishedAt ?? lastCompleted.startedAt;
  const daysAgo = calendarDaysAgo(finishedAt, now);
  const recentlyTrained = now - finishedAt < DAY_MS || daysAgo <= 1;

  const mustAvoidLower =
    candidate.kind === 'lower' && lastTemplate.kind === 'lower' && recentlyTrained;

  if (!mustAvoidLower) return { templateId: candidate.id };

  // Walk forward through the rotation to the next upper day.
  for (let step = 2; step <= cycle.length; step++) {
    const next = cycle[(lastIndex + step) % cycle.length]!;
    if (next.kind === 'upper') {
      return {
        templateId: next.id,
        skippedTemplateId: candidate.id,
        reason: `You trained ${lastTemplate.name} ${whenPhrase(finishedAt, now)} — doing ${next.name} instead.`,
      };
    }
  }

  // No upper day exists at all; fall back to the plain rotation.
  return { templateId: candidate.id };
}
