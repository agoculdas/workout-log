import { describe, expect, it } from 'vitest';
import {
  dayKindLabel,
  dayShortLabel,
  isLowerDay,
  isUpperDay,
  rotationShape,
  tagsClash,
} from './days';
import { PRESETS } from '../db/presets';
import { SEED_TEMPLATES, seedProgramme } from '../db/seed';
import type { SplitTag, Template } from '../db/types';

const day = (tags: SplitTag[], over: Partial<Template> = {}): Template => ({
  id: 'd',
  programmeId: 'p',
  name: 'Day',
  tags,
  order: 0,
  ...over,
});

describe('isLowerDay / isUpperDay', () => {
  it('reads lower from either the upper/lower tag or the PPL one', () => {
    expect(isLowerDay(day(['lower']))).toBe(true);
    expect(isLowerDay(day(['legs']))).toBe(true);
    expect(isLowerDay(day(['lower', 'legs']))).toBe(true);
    expect(isLowerDay(day(['upper', 'push']))).toBe(false);
    expect(isLowerDay(day([]))).toBe(false);
  });

  it('reads upper from the upper tag or any upper-body tag', () => {
    expect(isUpperDay(day(['upper']))).toBe(true);
    expect(isUpperDay(day(['push']))).toBe(true);
    expect(isUpperDay(day(['pull']))).toBe(true);
    expect(isUpperDay(day(['chest']))).toBe(true);
    expect(isUpperDay(day(['back']))).toBe(true);
    expect(isUpperDay(day(['shoulders']))).toBe(true);
    expect(isUpperDay(day(['arms']))).toBe(true);
    expect(isUpperDay(day(['lower', 'legs']))).toBe(false);
  });

  it('calls a full-body day both', () => {
    const full = day(['upper', 'lower', 'push', 'pull', 'legs']);
    expect(isLowerDay(full)).toBe(true);
    expect(isUpperDay(full)).toBe(true);
  });

  it('matches the seeded days', () => {
    const byId = new Map(SEED_TEMPLATES.map((t) => [t.id, t]));
    expect(isLowerDay(byId.get('lowerA')!)).toBe(true);
    expect(isUpperDay(byId.get('lowerA')!)).toBe(false);
    expect(isUpperDay(byId.get('upperB')!)).toBe(true);
    expect(isLowerDay(byId.get('upperB')!)).toBe(false);
  });
});

describe('dayKindLabel', () => {
  it('names the stock days Lower and Upper', () => {
    expect(dayKindLabel(day(['lower']))).toBe('Lower');
    expect(dayKindLabel(day(['upper']))).toBe('Upper');
  });

  it('prefers Legs over Lower, so a PPL leg day is not called Lower', () => {
    expect(dayKindLabel(day(['lower', 'legs']))).toBe('Legs');
    expect(dayKindLabel(day(['legs']))).toBe('Legs');
  });

  it('labels every seeded day and every preset day', () => {
    expect(SEED_TEMPLATES.map(dayKindLabel)).toEqual(['Lower', 'Upper', 'Lower', 'Upper']);
    const byPreset = Object.fromEntries(
      PRESETS.map((preset) => [preset.id, preset.days.map(dayKindLabel)]),
    );
    expect(byPreset['upper_lower_4']).toEqual(['Lower', 'Upper', 'Lower', 'Upper']);
    expect(byPreset['ppl_6']).toEqual(['Push', 'Pull', 'Legs']);
    expect(byPreset['ppl_3']).toEqual(['Push', 'Pull', 'Legs']);
    expect(byPreset['full_body_3']).toEqual(['Full body', 'Full body', 'Full body']);
    expect(byPreset['body_part_5']).toEqual(['Push', 'Pull', 'Legs', 'Push', 'Push']);
  });

  it('prefers the PPL tag over the upper/lower one', () => {
    expect(dayKindLabel(day(['upper', 'push']))).toBe('Push');
    expect(dayKindLabel(day(['upper', 'pull', 'back']))).toBe('Pull');
  });

  it('calls a day that is both Full body', () => {
    expect(dayKindLabel(day(['upper', 'lower', 'push', 'pull', 'legs']))).toBe('Full body');
    expect(dayKindLabel(day(['upper', 'legs']))).toBe('Full body');
  });

  it('falls back to Day when nothing says which half of the body it is', () => {
    expect(dayKindLabel(day(['core']))).toBe('Day');
    expect(dayKindLabel(day([]))).toBe('Day');
  });

  it('abbreviates to one letter, or FB for full body', () => {
    expect(dayShortLabel(day(['lower']))).toBe('L');
    expect(dayShortLabel(day(['lower', 'legs']))).toBe('L');
    expect(dayShortLabel(day(['upper']))).toBe('U');
    expect(dayShortLabel(day(['upper', 'push']))).toBe('P');
    expect(dayShortLabel(day(['upper', 'lower']))).toBe('FB');
  });
});

describe('tagsClash', () => {
  it('is true only when the two days are the same kind of day', () => {
    // Lower A and Lower B, identically tagged.
    expect(tagsClash(['lower'], ['lower'])).toBe(true);
    // Two PPL legs days, in either tag order.
    expect(tagsClash(['lower', 'legs'], ['lower', 'legs'])).toBe(true);
    expect(tagsClash(['legs', 'lower'], ['lower', 'legs'])).toBe(true);
    // Two identically tagged full-body days.
    const full: SplitTag[] = ['upper', 'lower', 'push', 'pull', 'legs'];
    expect(tagsClash(full, [...full])).toBe(true);
  });

  it('is false when the two days merely overlap', () => {
    // Push and Pull share `upper` but train nothing in common.
    expect(tagsClash(['upper', 'push'], ['upper', 'pull'])).toBe(false);
    // Chest and Shoulders share `upper` and `push`.
    expect(tagsClash(['upper', 'push', 'chest'], ['upper', 'push', 'shoulders'])).toBe(false);
    // A subset is not the same day either: a PPL Legs day and a stock Lower
    // day belong to different programmes, and only one is ever running.
    expect(tagsClash(['lower', 'legs'], ['lower'])).toBe(false);
  });

  it('is false when nothing is shared at all', () => {
    expect(tagsClash(['lower', 'legs'], ['upper', 'push'])).toBe(false);
  });

  it('ignores cardio and core, which belong to no split', () => {
    expect(tagsClash(['cardio'], ['cardio'])).toBe(false);
    expect(tagsClash(['core'], ['core', 'cardio'])).toBe(false);
    expect(tagsClash(['lower', 'core'], ['upper', 'core'])).toBe(false);
    // Dropping them can leave two sets that are equal after all.
    expect(tagsClash(['lower', 'core'], ['lower', 'cardio'])).toBe(true);
    expect(tagsClash(['lower', 'legs', 'core'], ['lower', 'legs'])).toBe(true);
  });

  it('is false for an empty or missing list', () => {
    expect(tagsClash([], ['upper'])).toBe(false);
    expect(tagsClash(['upper'], [])).toBe(false);
    expect(tagsClash(undefined, ['upper'])).toBe(false);
    expect(tagsClash([], [])).toBe(false);
  });

  it('never clashes the stock days with the other half of the week', () => {
    const byId = new Map(SEED_TEMPLATES.map((t) => [t.id, t]));
    const tags = (id: string) => byId.get(id)!.tags;
    expect(tagsClash(tags('lowerA'), tags('lowerB'))).toBe(true);
    expect(tagsClash(tags('upperA'), tags('upperB'))).toBe(true);
    expect(tagsClash(tags('lowerA'), tags('upperA'))).toBe(false);
  });
});

describe('rotationShape', () => {
  it('renders the stock week', () => {
    expect(rotationShape(seedProgramme(0), SEED_TEMPLATES)).toBe(
      'L · U · rest · L · U · rest · rest',
    );
  });

  it('uses FB for full-body days', () => {
    const full: Template[] = [
      day(['upper', 'lower'], { id: 'a', name: 'A' }),
      day(['upper', 'lower'], { id: 'b', name: 'B' }),
    ];
    expect(
      rotationShape(
        { rotation: [{ templateId: 'a' }, { rest: true }, { templateId: 'b' }] },
        full,
      ),
    ).toBe('FB · rest · FB');
  });

  it('reads a missing or archived day as rest, the way the picker does', () => {
    const days: Template[] = [
      day(['upper'], { id: 'a', name: 'A' }),
      day(['lower'], { id: 'b', name: 'B', archived: true }),
    ];
    expect(
      rotationShape(
        { rotation: [{ templateId: 'a' }, { templateId: 'b' }, { templateId: 'gone' }] },
        days,
      ),
    ).toBe('U · rest · rest');
  });

  it('is empty for an empty or missing rotation', () => {
    expect(rotationShape({ rotation: [] }, SEED_TEMPLATES)).toBe('');
    expect(rotationShape(undefined, SEED_TEMPLATES)).toBe('');
  });
});
