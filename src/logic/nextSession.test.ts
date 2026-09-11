import { describe, expect, it } from 'vitest';
import { calendarDaysAgo, pickNextSession } from './nextSession';
import { SEED_TEMPLATES } from '../db/seed';
import type { Session, Template, TemplateId } from '../db/types';

const templates: Template[] = SEED_TEMPLATES;
const NOW = new Date('2024-05-15T18:00:00').getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function completed(templateId: TemplateId, finishedAt: number): Session {
  return { id: `s_${templateId}_${finishedAt}`, templateId, startedAt: finishedAt - HOUR, finishedAt };
}

describe('pickNextSession — rotation', () => {
  it('starts at Lower A with no history', () => {
    expect(pickNextSession(templates, undefined, NOW)).toEqual({ templateId: 'lowerA' });
  });

  it('cycles lowerA → upperA → lowerB → upperB → lowerA', () => {
    const threeDaysAgo = NOW - 3 * DAY;
    expect(pickNextSession(templates, completed('lowerA', threeDaysAgo), NOW).templateId).toBe('upperA');
    expect(pickNextSession(templates, completed('upperA', threeDaysAgo), NOW).templateId).toBe('lowerB');
    expect(pickNextSession(templates, completed('lowerB', threeDaysAgo), NOW).templateId).toBe('upperB');
    expect(pickNextSession(templates, completed('upperB', threeDaysAgo), NOW).templateId).toBe('lowerA');
  });

  it('does not add a reason when the plain rotation applies', () => {
    expect(pickNextSession(templates, completed('upperA', NOW - 2 * HOUR), NOW).reason).toBeUndefined();
  });

  it('offers a lower day after an upper day even on the same evening', () => {
    expect(pickNextSession(templates, completed('upperA', NOW - HOUR), NOW).templateId).toBe('lowerB');
  });

  it('is unaffected by template array order', () => {
    const shuffled = [...templates].reverse();
    expect(pickNextSession(shuffled, completed('lowerA', NOW - 3 * DAY), NOW).templateId).toBe('upperA');
  });
});

describe('pickNextSession — never lower after lower', () => {
  // A rotation where the successor of a lower day is another lower day.
  const lowerHeavy: Template[] = [
    { id: 'lowerA', name: 'Lower A', kind: 'lower', order: 0 },
    { id: 'lowerB', name: 'Lower B', kind: 'lower', order: 1 },
    { id: 'upperB', name: 'Upper B', kind: 'upper', order: 2 },
    { id: 'upperA', name: 'Upper A', kind: 'upper', order: 3 },
  ];

  it('skips forward to the next upper day when lower was trained yesterday', () => {
    const result = pickNextSession(lowerHeavy, completed('lowerA', NOW - 20 * HOUR), NOW);
    expect(result.templateId).toBe('upperB');
    expect(result.skippedTemplateId).toBe('lowerB');
    expect(result.reason).toBe('You trained Lower A yesterday — doing Upper B instead.');
  });

  it('skips when the lower day finished earlier the same day', () => {
    const result = pickNextSession(lowerHeavy, completed('lowerA', NOW - 2 * HOUR), NOW);
    expect(result.templateId).toBe('upperB');
    expect(result.reason).toContain('today');
  });

  it('allows the lower day once two days have passed', () => {
    const result = pickNextSession(lowerHeavy, completed('lowerA', NOW - 2 * DAY - HOUR), NOW);
    expect(result.templateId).toBe('lowerB');
    expect(result.reason).toBeUndefined();
  });

  it('never returns a lower day within 24 h of a lower session', () => {
    for (let h = 0; h < 24; h++) {
      const result = pickNextSession(lowerHeavy, completed('lowerA', NOW - h * HOUR), NOW);
      const picked = lowerHeavy.find((t) => t.id === result.templateId);
      expect(picked?.kind).toBe('upper');
    }
  });
});

describe('calendarDaysAgo', () => {
  it('counts calendar days, not 24 h blocks', () => {
    const today9am = new Date('2024-05-15T09:00:00').getTime();
    const yesterday11pm = new Date('2024-05-14T23:00:00').getTime();
    expect(calendarDaysAgo(today9am, NOW)).toBe(0);
    expect(calendarDaysAgo(yesterday11pm, NOW)).toBe(1);
    expect(calendarDaysAgo(new Date('2024-05-12T10:00:00').getTime(), NOW)).toBe(3);
  });
});
