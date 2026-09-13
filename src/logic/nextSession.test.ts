import { describe, expect, it } from 'vitest';
import { calendarDaysAgo, nextSlotIndex, pickNextSession } from './nextSession';
import { PRESETS, type ProgrammePreset } from '../db/presets';
import { SEED_ROTATION, SEED_TEMPLATES, seedProgramme } from '../db/seed';
import type {
  Programme,
  RotationSlot,
  Session,
  SplitTag,
  Template,
} from '../db/types';

const NOW = new Date('2024-05-15T18:00:00').getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function day(id: string, name: string, tags: SplitTag[], order: number): Template {
  return { id, programmeId: 'p1', name, tags, order, archived: false };
}

function programme(rotation: RotationSlot[]): Programme {
  return { id: 'p1', name: 'Test', rotation, active: true, createdAt: 0, archived: false };
}

function done(templateId: string, finishedAt: number, slotIndex?: number): Session {
  return {
    id: `s_${templateId}_${finishedAt}`,
    templateId,
    startedAt: finishedAt - HOUR,
    finishedAt,
    ...(slotIndex === undefined ? {} : { slotIndex }),
  };
}

/** The stock upper/lower programme, exactly as the seed writes it. */
const stock = seedProgramme(0);
const stockDays = SEED_TEMPLATES;

/* ------------------------------------------------------------ nextSlotIndex */

describe('nextSlotIndex', () => {
  it('starts at slot 0 with no history', () => {
    expect(nextSlotIndex(stock, undefined)).toBe(0);
  });

  it('is the slot after the last session, wrapping round', () => {
    expect(nextSlotIndex(stock, done('lowerA', NOW, 0))).toBe(1);
    expect(nextSlotIndex(stock, done('upperB', NOW, 4))).toBe(5);
    expect(nextSlotIndex(stock, done('upperB', NOW, 6))).toBe(0);
  });

  it('falls back to the first occurrence of the template when slotIndex is absent', () => {
    // Upper B sits at slot 4, so the walk resumes at the rest slot after it.
    expect(nextSlotIndex(stock, done('upperB', NOW))).toBe(5);
    expect(nextSlotIndex(stock, done('lowerA', NOW))).toBe(1);
  });

  it('starts over when the last session names a day the rotation never had', () => {
    expect(nextSlotIndex(stock, done('gone', NOW))).toBe(0);
  });

  it('returns -1 for an empty rotation', () => {
    expect(nextSlotIndex(programme([]), undefined)).toBe(-1);
    expect(nextSlotIndex(undefined, undefined)).toBe(-1);
  });
});

/* ------------------------------------------------------- the plain rotation */

describe('pickNextSession — walking the rotation', () => {
  it('offers the first slot with no history', () => {
    expect(pickNextSession(stock, stockDays, [], NOW)).toEqual({
      kind: 'train',
      templateId: 'lowerA',
      slotIndex: 0,
    });
  });

  it('follows the rotation, one slot at a time', () => {
    const threeDaysAgo = NOW - 3 * DAY;
    expect(pickNextSession(stock, stockDays, [done('lowerA', threeDaysAgo, 0)], NOW)).toMatchObject(
      { kind: 'train', templateId: 'upperA', slotIndex: 1 },
    );
    expect(pickNextSession(stock, stockDays, [done('lowerB', threeDaysAgo, 3)], NOW)).toMatchObject(
      { kind: 'train', templateId: 'upperB', slotIndex: 4 },
    );
  });

  it('adds no reason when the plain rotation applies', () => {
    const pick = pickNextSession(stock, stockDays, [done('lowerA', NOW - 2 * HOUR, 0)], NOW);
    expect(pick.reason).toBeUndefined();
  });

  it('surfaces a rest slot as rest, with the day that follows it', () => {
    // Upper A finished a couple of hours ago: the rest day has not elapsed.
    const pick = pickNextSession(stock, stockDays, [done('upperA', NOW - 2 * HOUR, 1)], NOW);
    expect(pick).toEqual({
      kind: 'rest',
      slotIndex: 2,
      restDay: 1,
      restTotal: 1,
      nextTemplateId: 'lowerB',
      nextSlotIndex: 3,
    });
  });

  it('counts down a run of rest slots, then trains', () => {
    // Slot 4 is Upper B; 5 and 6 are both rest, so the next day wraps to slot 0.
    const after = (ms: number) =>
      pickNextSession(stock, stockDays, [done('upperB', NOW - ms, 4)], NOW);

    expect(after(2 * HOUR)).toEqual({
      kind: 'rest',
      slotIndex: 5,
      restDay: 1,
      restTotal: 2,
      nextTemplateId: 'lowerA',
      nextSlotIndex: 0,
    });
    // Each rest slot is a whole calendar day: finish on Monday and Tuesday is
    // still the first of the two, Wednesday the second, Thursday trains.
    expect(after(DAY + 2 * HOUR)).toMatchObject({ kind: 'rest', restDay: 1, restTotal: 2 });
    expect(after(2 * DAY + 2 * HOUR)).toMatchObject({
      kind: 'rest',
      restDay: 2,
      restTotal: 2,
    });
    expect(after(3 * DAY + 2 * HOUR)).toEqual({
      kind: 'train',
      templateId: 'lowerA',
      slotIndex: 0,
      restTaken: 2,
    });
    // And it stays trainable once the rest days are behind you.
    expect(after(5 * DAY)).toMatchObject({ kind: 'train', templateId: 'lowerA', restTaken: 2 });
  });

  it('holds a single rest day for a whole calendar day, then lets it go', () => {
    // Slot 2 is one rest day. Upper A yesterday means today *is* that rest day.
    const after = (ms: number) =>
      pickNextSession(stock, stockDays, [done('upperA', NOW - ms, 1)], NOW);

    expect(after(DAY + 2 * HOUR)).toEqual({
      kind: 'rest',
      slotIndex: 2,
      restDay: 1,
      restTotal: 1,
      nextTemplateId: 'lowerB',
      nextSlotIndex: 3,
    });
    // Two days on it has been taken.
    expect(after(2 * DAY + 2 * HOUR)).toEqual({
      kind: 'train',
      templateId: 'lowerB',
      slotIndex: 3,
      restTaken: 1,
    });
  });

  it('offers the next training day straight away when no rest slot sits between', () => {
    // Slot 1 is a training day and Lower A was finished this morning: with no
    // rest slots to take, Upper A is simply next. A second session on the same
    // day is the user's call, never a 'rest' state.
    expect(pickNextSession(stock, stockDays, [done('lowerA', NOW - 2 * HOUR, 0)], NOW)).toEqual({
      kind: 'train',
      templateId: 'upperA',
      slotIndex: 1,
    });
    expect(
      pickNextSession(stock, stockDays, [done('lowerA', NOW - DAY - 2 * HOUR, 0)], NOW),
    ).toEqual({ kind: 'train', templateId: 'upperA', slotIndex: 1 });
  });

  it('never claims rest was taken on the very first session', () => {
    const restFirst = programme([{ rest: true }, { templateId: 'lowerA' }]);
    expect(pickNextSession(restFirst, stockDays, [], NOW)).toEqual({
      kind: 'train',
      templateId: 'lowerA',
      slotIndex: 1,
    });
  });

  it('continues from the slot a rest-day session was started on', () => {
    // "Train anyway" on rest slot 2 starts Lower B (slot 3) — the walk then
    // resumes at slot 4, not back at the rest day.
    const pick = pickNextSession(stock, stockDays, [done('lowerB', NOW - 2 * DAY, 3)], NOW);
    expect(pick).toMatchObject({ kind: 'train', templateId: 'upperB', slotIndex: 4 });
  });

  it('treats a slot whose day is archived or missing as rest', () => {
    // Retiring Upper A turns slots 1 and 2 into a two-day rest run. 25 h keeps
    // the clash rule out of it, so only the rest count is under test.
    const archived = stockDays.map((t) =>
      t.id === 'upperA' ? { ...t, archived: true } : { ...t },
    );
    const last = [done('lowerA', NOW - DAY - HOUR, 0)];
    expect(pickNextSession(stock, archived, last, NOW)).toEqual({
      kind: 'rest',
      slotIndex: 1,
      restDay: 1,
      restTotal: 2,
      nextTemplateId: 'lowerB',
      nextSlotIndex: 3,
    });

    const missing = stockDays.filter((t) => t.id !== 'upperA');
    expect(pickNextSession(stock, missing, last, NOW)).toMatchObject({
      kind: 'rest',
      slotIndex: 1,
      restTotal: 2,
    });
    expect(
      pickNextSession(stock, archived, [done('lowerA', NOW - 2 * DAY - HOUR, 0)], NOW),
    ).toMatchObject({ kind: 'rest', restDay: 2, restTotal: 2 });
    // Three days on and both of those rest slots count as taken.
    expect(
      pickNextSession(stock, archived, [done('lowerA', NOW - 3 * DAY - HOUR, 0)], NOW),
    ).toMatchObject({ kind: 'train', templateId: 'lowerB', slotIndex: 3, restTaken: 2 });
  });
});

/* ----------------------------------------------------------- the clash rule */

describe('pickNextSession — the clash rule', () => {
  const legs = day('legsA', 'Legs A', ['lower', 'legs'], 0);
  const legsB = day('legsB', 'Legs B', ['lower', 'legs'], 1);
  const push = day('push', 'Push', ['upper', 'push'], 2);
  const days = [legs, legsB, push];
  const back2back = programme([
    { templateId: 'legsA' },
    { templateId: 'legsB' },
    { templateId: 'push' },
  ]);
  const withRest = programme([
    { templateId: 'legsA' },
    { rest: true },
    { templateId: 'legsB' },
    { templateId: 'push' },
  ]);
  /**
   * Late yesterday: a previous calendar day, so the rest boundary is behind
   * us and a training slot really is on offer, yet still inside the 24 h
   * window the clash rule looks at.
   */
  const LAST_NIGHT = 20 * HOUR;

  it('skips a day that shares a tag with something trained in the last 24 h', () => {
    const pick = pickNextSession(back2back, days, [done('legsA', NOW - 20 * HOUR, 0)], NOW);
    expect(pick).toEqual({
      kind: 'train',
      templateId: 'push',
      slotIndex: 2,
      skippedTemplateId: 'legsB',
      reason: 'You trained Legs A yesterday — doing Push instead.',
    });
  });

  it('says "today" when the clashing session was earlier the same day', () => {
    // Training today means today is spent, so this lands on the rest slot —
    // but the clash still moves the day it offers next, and names when.
    const pick = pickNextSession(withRest, days, [done('legsA', NOW - 2 * HOUR, 0)], NOW);
    expect(pick).toMatchObject({ kind: 'rest', nextTemplateId: 'push', nextSlotIndex: 3 });
    expect(pick.reason).toContain('today');
    expect(pick.reason).toContain('doing Push instead');
  });

  it('lets the rotation stand once 24 h have passed', () => {
    const pick = pickNextSession(back2back, days, [done('legsA', NOW - DAY - HOUR, 0)], NOW);
    expect(pick).toEqual({ kind: 'train', templateId: 'legsB', slotIndex: 1 });
  });

  it('never offers a clashing day inside the 24 h window', () => {
    // Legs A finished at 22:00 yesterday; walk through today, which is a
    // training day again but stays inside the clash window all the way to 22:00.
    const finished = new Date('2024-05-14T22:00:00').getTime();
    for (let h = 3; h < 24; h++) {
      const now = finished + h * HOUR;
      const pick = pickNextSession(back2back, days, [done('legsA', finished, 0)], now);
      expect(pick, `${h} h after`).toMatchObject({ kind: 'train', templateId: 'push' });
    }
  });

  it('gives up silently when every day in the rotation clashes', () => {
    const allLegs = [legs, legsB];
    const pick = pickNextSession(
      programme([{ templateId: 'legsA' }, { templateId: 'legsB' }]),
      allLegs,
      [done('legsA', NOW - LAST_NIGHT, 0)],
      NOW,
    );
    expect(pick).toEqual({ kind: 'train', templateId: 'legsB', slotIndex: 1 });
  });

  it('does not fire between two days that merely share a tag', () => {
    // Push yesterday evening, Pull this evening: 23 h apart, but a different
    // kind of day, so the rotation stands.
    const pull = day('pull', 'Pull', ['upper', 'pull'], 3);
    const pplish = programme([{ templateId: 'push' }, { templateId: 'pull' }]);
    expect(
      pickNextSession(pplish, [push, pull], [done('push', NOW - 23 * HOUR, 0)], NOW),
    ).toEqual({ kind: 'train', templateId: 'pull', slotIndex: 1 });
  });

  it('explains a skipped day on a rest pick too', () => {
    const pick = pickNextSession(withRest, days, [done('legsA', NOW - HOUR, 0)], NOW);
    expect(pick).toMatchObject({
      kind: 'rest',
      slotIndex: 1,
      restDay: 1,
      restTotal: 1,
      nextTemplateId: 'push',
      nextSlotIndex: 3,
    });
    expect(pick.reason).toContain('doing Push instead');
  });

  it('counts a session logged under another programme', () => {
    const foreign = day('other', 'Leg day', ['lower', 'legs'], 0);
    const pick = pickNextSession(
      programme([{ templateId: 'legsA' }, { templateId: 'push' }]),
      [legs, push, foreign],
      [done('other', NOW - LAST_NIGHT)],
      NOW,
    );
    expect(pick).toMatchObject({ kind: 'train', templateId: 'push' });
    expect(pick.reason).toContain('Leg day');
  });

  it('ignores a session whose day cannot be resolved at all', () => {
    const pick = pickNextSession(
      programme([{ templateId: 'legsA' }, { templateId: 'push' }]),
      [legs, push],
      [done('vanished', NOW - LAST_NIGHT)],
      NOW,
    );
    expect(pick).toMatchObject({ kind: 'train', templateId: 'legsA', slotIndex: 0 });
  });

  it('does not let cardio or core alone cause a clash', () => {
    const cardio = day('cardio', 'Conditioning', ['cardio', 'core'], 0);
    const alsoCardio = day('cardio2', 'Rowing', ['cardio'], 1);
    const pick = pickNextSession(
      programme([{ templateId: 'cardio' }, { templateId: 'cardio2' }]),
      [cardio, alsoCardio],
      [done('cardio', NOW - LAST_NIGHT, 0)],
      NOW,
    );
    expect(pick).toEqual({ kind: 'train', templateId: 'cardio2', slotIndex: 1 });
  });
});

/* ---------------------------------------------------------------- the presets */

/** A preset as in-memory rows, without going near Dexie. */
function buildPreset(preset: ProgrammePreset): {
  programme: Programme;
  templates: Template[];
} {
  const templates = preset.days.map((d, i) =>
    day(`${preset.id}_${i}`, d.name, [...d.tags], i),
  );
  const rotation: RotationSlot[] = preset.rotation.map((slot) =>
    slot === 'rest' ? { rest: true } : { templateId: templates[slot]!.id },
  );
  return {
    programme: { ...programme(rotation), id: preset.id, name: preset.name },
    templates,
  };
}

describe('pickNextSession — the shipped presets', () => {
  it.each(PRESETS.map((p) => [p.id, p] as const))(
    'walks %s for two full rotations without ever tripping the clash rule',
    (_id, preset) => {
      const { programme: prog, templates } = buildPreset(preset);
      const trainingSlots = preset.rotation
        .map((slot, index) => (slot === 'rest' ? -1 : index))
        .filter((index) => index >= 0);

      const completed: Session[] = [];
      const visited: number[] = [];
      let now = NOW;

      // Train every day the rotation offers one, taking the "train anyway"
      // day when the rotation says rest. One session a day, an hour later
      // each time, which is how this is actually used.
      for (let step = 0; step < trainingSlots.length * 2; step++) {
        const pick = pickNextSession(prog, templates, completed, now);
        expect(pick.reason).toBeUndefined();
        const slotIndex = pick.kind === 'train' ? pick.slotIndex : pick.nextSlotIndex;
        const templateId = pick.kind === 'train' ? pick.templateId : pick.nextTemplateId;
        expect(slotIndex).toBeTypeOf('number');
        expect(templateId).toBeTypeOf('string');
        if (pick.kind === 'train') expect(pick.skippedTemplateId).toBeUndefined();
        visited.push(slotIndex!);
        completed.unshift(done(templateId!, now, slotIndex!));
        now += DAY + HOUR;
      }

      // Every training slot, in rotation order, twice round.
      expect(visited).toEqual([...trainingSlots, ...trainingSlots]);
    },
  );

  it.each(PRESETS.map((p) => [p.id, p] as const))(
    'surfaces every rest slot in %s as a rest pick on the day it falls',
    (_id, preset) => {
      const { programme: prog, templates } = buildPreset(preset);
      preset.rotation.forEach((slot, index) => {
        if (slot !== 'rest') return;
        // A session finished today on the slot before this one: the rest day
        // is still ahead, so it has to show as rest.
        const previous = (index - 1 + preset.rotation.length) % preset.rotation.length;
        const pick = pickNextSession(
          prog,
          templates,
          [done(templates[0]!.id, NOW - 2 * HOUR, previous)],
          NOW,
        );
        expect(pick.kind).toBe('rest');
        expect(pick.slotIndex).toBe(index);
        if (pick.kind === 'rest') {
          expect(pick.restDay).toBe(1);
          expect(pick.restTotal).toBeGreaterThanOrEqual(1);
        }
      });
    },
  );

  it.each(PRESETS.map((p) => [p.id, p] as const))(
    'offers every training slot in %s when the rotation lands on it',
    (_id, preset) => {
      const { programme: prog, templates } = buildPreset(preset);
      preset.rotation.forEach((slot, index) => {
        if (slot === 'rest') return;
        const previous = (index - 1 + preset.rotation.length) % preset.rotation.length;
        // Three days ago: no rest left to take and well outside the clash window.
        const pick = pickNextSession(
          prog,
          templates,
          [done(templates[0]!.id, NOW - 3 * DAY, previous)],
          NOW,
        );
        expect(pick.kind).toBe('train');
        expect(pick.slotIndex).toBe(index);
      });
    },
  );

  it('counts the ppl_3 rest day down and then lets it go', () => {
    const { programme: prog, templates } = buildPreset(
      PRESETS.find((p) => p.id === 'ppl_3')!,
    );
    const [pushDay, pullDay] = templates;
    const pushed = [done(pushDay!.id, NOW, 0)];

    // Two hours after Push: slot 1 is the rest day, and it has not elapsed.
    expect(pickNextSession(prog, templates, pushed, NOW + 2 * HOUR)).toEqual({
      kind: 'rest',
      slotIndex: 1,
      restDay: 1,
      restTotal: 1,
      nextTemplateId: pullDay!.id,
      nextSlotIndex: 2,
    });

    // The next day *is* the rest day, so it still reads "1 of 1".
    expect(pickNextSession(prog, templates, pushed, NOW + 26 * HOUR)).toMatchObject({
      kind: 'rest',
      slotIndex: 1,
      restDay: 1,
      restTotal: 1,
    });

    // Two days on it has been taken, and Pull comes round.
    expect(pickNextSession(prog, templates, pushed, NOW + 2 * DAY + 2 * HOUR)).toEqual({
      kind: 'train',
      templateId: pullDay!.id,
      slotIndex: 2,
      restTaken: 1,
    });
  });

  it('reproduces the stock rotation for upper_lower_4', () => {
    const preset = PRESETS.find((p) => p.id === 'upper_lower_4')!;
    const shape = preset.rotation.map((slot) => (slot === 'rest' ? 'rest' : slot));
    expect(shape).toEqual([0, 1, 'rest', 2, 3, 'rest', 'rest']);
    expect(SEED_ROTATION.map((s) => ('rest' in s ? 'rest' : s.templateId))).toEqual([
      'lowerA',
      'upperA',
      'rest',
      'lowerB',
      'upperB',
      'rest',
      'rest',
    ]);
  });
});

/* -------------------------------------------------------------- degradation */

describe('pickNextSession — empty and broken rotations', () => {
  it('offers the first day when the rotation is empty', () => {
    const days = [day('b', 'B', ['upper'], 1), day('a', 'A', ['lower'], 0)];
    expect(pickNextSession(programme([]), days, [], NOW)).toEqual({
      kind: 'train',
      templateId: 'a',
      slotIndex: -1,
    });
  });

  it('reports rest when there is no rotation and no day either', () => {
    const nothing = { kind: 'rest', slotIndex: -1, restDay: 0, restTotal: 0 };
    expect(pickNextSession(programme([]), [], [], NOW)).toEqual(nothing);
    expect(pickNextSession(undefined, [], [], NOW)).toEqual(nothing);
  });

  it('reports rest forever when every slot in the rotation is a rest day', () => {
    expect(
      pickNextSession(programme([{ rest: true }, { rest: true }]), stockDays, [], NOW),
    ).toEqual({ kind: 'rest', slotIndex: 0, restDay: 1, restTotal: 2 });
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
