import { describe, expect, it } from 'vitest';
import type { RotationSlot, Template } from '../../db/types';
import { PRESETS, getPreset } from '../../db/presets';
import {
  addDaySlot,
  addRestSlot,
  dayCountLabel,
  daysOf,
  isRest,
  moveSlot,
  presetShape,
  removeSlot,
  rotationSummary,
  trainingDayCount,
} from './rotationUtils';

function day(id: string, patch: Partial<Template> = {}): Template {
  return {
    id,
    programmeId: 'p1',
    name: id,
    tags: ['lower'],
    order: 0,
    ...patch,
  };
}

const TEMPLATES: Template[] = [
  day('lowerA', { name: 'Lower A', tags: ['lower'], order: 0 }),
  day('upperA', { name: 'Upper A', tags: ['upper'], order: 1 }),
];

const ROTATION: RotationSlot[] = [
  { templateId: 'lowerA' },
  { templateId: 'upperA' },
  { rest: true },
];

describe('isRest', () => {
  it('separates rest slots from training slots', () => {
    expect(isRest({ rest: true })).toBe(true);
    expect(isRest({ templateId: 'lowerA' })).toBe(false);
  });
});

describe('moveSlot', () => {
  it('swaps with the previous slot', () => {
    expect(moveSlot(ROTATION, 1, -1)).toEqual([
      { templateId: 'upperA' },
      { templateId: 'lowerA' },
      { rest: true },
    ]);
  });

  it('swaps with the next slot', () => {
    expect(moveSlot(ROTATION, 1, 1)).toEqual([
      { templateId: 'lowerA' },
      { rest: true },
      { templateId: 'upperA' },
    ]);
  });

  it('leaves the ends alone', () => {
    expect(moveSlot(ROTATION, 0, -1)).toEqual(ROTATION);
    expect(moveSlot(ROTATION, 2, 1)).toEqual(ROTATION);
  });

  it('ignores an index outside the list', () => {
    expect(moveSlot(ROTATION, 9, -1)).toEqual(ROTATION);
    expect(moveSlot(ROTATION, -1, 1)).toEqual(ROTATION);
  });

  it('never mutates the input', () => {
    const input: RotationSlot[] = [...ROTATION];
    moveSlot(input, 0, 1);
    expect(input).toEqual(ROTATION);
  });
});

describe('removeSlot', () => {
  it('drops the slot at the index', () => {
    expect(removeSlot(ROTATION, 1)).toEqual([{ templateId: 'lowerA' }, { rest: true }]);
  });

  it('drops only the one occurrence, not every slot for that day', () => {
    const repeated: RotationSlot[] = [
      { templateId: 'lowerA' },
      { templateId: 'lowerA' },
      { rest: true },
    ];
    expect(removeSlot(repeated, 0)).toEqual([{ templateId: 'lowerA' }, { rest: true }]);
  });

  it('ignores an index outside the list', () => {
    expect(removeSlot(ROTATION, 5)).toEqual(ROTATION);
    expect(removeSlot(ROTATION, -2)).toEqual(ROTATION);
  });

  it('empties a one-slot rotation', () => {
    expect(removeSlot([{ rest: true }], 0)).toEqual([]);
  });
});

describe('addDaySlot / addRestSlot', () => {
  it('appends a training day at the end', () => {
    expect(addDaySlot(ROTATION, 'upperA')).toEqual([...ROTATION, { templateId: 'upperA' }]);
  });

  it('appends a rest day at the end', () => {
    expect(addRestSlot(ROTATION)).toEqual([...ROTATION, { rest: true }]);
  });

  it('builds up from empty', () => {
    expect(addRestSlot(addDaySlot([], 'lowerA'))).toEqual([
      { templateId: 'lowerA' },
      { rest: true },
    ]);
  });
});

describe('trainingDayCount', () => {
  it('counts the non-rest slots', () => {
    expect(trainingDayCount(ROTATION)).toBe(2);
  });

  it('discounts slots whose day is gone or archived', () => {
    const withGhost: RotationSlot[] = [...ROTATION, { templateId: 'deleted' }];
    expect(trainingDayCount(withGhost, TEMPLATES)).toBe(2);
    expect(
      trainingDayCount(ROTATION, [TEMPLATES[0]!, { ...TEMPLATES[1]!, archived: true }]),
    ).toBe(1);
  });

  it('is zero for an empty rotation', () => {
    expect(trainingDayCount([], TEMPLATES)).toBe(0);
  });
});

describe('rotationSummary', () => {
  it('reads the upper/lower week', () => {
    const week: RotationSlot[] = [
      { templateId: 'lowerA' },
      { templateId: 'upperA' },
      { rest: true },
      { templateId: 'lowerA' },
      { templateId: 'upperA' },
      { rest: true },
      { rest: true },
    ];
    expect(rotationSummary(week, TEMPLATES)).toBe('7 slots · 4 training days');
  });

  it('singularises both halves', () => {
    expect(rotationSummary([{ templateId: 'lowerA' }], TEMPLATES)).toBe(
      '1 slot · 1 training day',
    );
  });

  it('handles an empty rotation', () => {
    expect(rotationSummary([], TEMPLATES)).toBe('0 slots · 0 training days');
  });
});

describe('presetShape', () => {
  it('matches the upper/lower preset week', () => {
    expect(presetShape(getPreset('upper_lower_4')!)).toBe('L · U · rest · L · U · rest · rest');
  });

  it('produces a shape for every shipped preset', () => {
    for (const preset of PRESETS) {
      const shape = presetShape(preset);
      expect(shape.split(' · ')).toHaveLength(preset.rotation.length);
    }
  });

  it('falls back to rest for an index with no day', () => {
    expect(presetShape({ days: [], rotation: [0, 'rest'] })).toBe('rest · rest');
  });
});

describe('dayCountLabel / daysOf', () => {
  it('counts the live days only', () => {
    expect(dayCountLabel(TEMPLATES)).toBe('2 days');
    expect(dayCountLabel([TEMPLATES[0]!])).toBe('1 day');
    expect(dayCountLabel([{ ...TEMPLATES[0]!, archived: true }])).toBe('0 days');
  });

  it('picks one programme out of the whole table, in order', () => {
    const mixed: Template[] = [
      day('b', { order: 1 }),
      day('other', { programmeId: 'p2', order: 0 }),
      day('a', { order: 0 }),
      day('gone', { order: 2, archived: true }),
    ];
    expect(daysOf({ id: 'p1' }, mixed).map((t) => t.id)).toEqual(['a', 'b']);
  });
});
