import { describe, expect, it } from 'vitest';
import type { CatalogEntry, SplitTag, Template, TemplateId } from '../../db/types';
import { makeExercise } from '../../logic/testFixtures';
import {
  TAG_FILTER_GROUPS,
  appearsInLabel,
  blankCatalogDraft,
  draftToCatalogInput,
  entryMeta,
  groupByCatalogId,
  muscleList,
  muscleSummary,
  sortMuscles,
  swapOverrides,
  templateNames,
  toggleFilter,
  toggleMuscle,
  toggleTag,
  validateCatalogDraft,
} from './libraryUtils';

function makeEntry(patch: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: 'cat_test',
    name: 'Hack squat',
    primary: ['quads'],
    secondary: ['glutes', 'adductors'],
    equipment: 'machine',
    pattern: 'squat',
    unilateral: false,
    tags: ['lower', 'legs'],
    defaultUnit: 'kg_total',
    defaultMeasure: 'reps',
    ...patch,
  };
}

const TEMPLATES: Template[] = [
  { id: 'lowerA', name: 'Lower A', kind: 'lower', order: 0 },
  { id: 'upperA', name: 'Upper A', kind: 'upper', order: 1 },
  { id: 'lowerB', name: 'Lower B', kind: 'lower', order: 2 },
  { id: 'upperB', name: 'Upper B', kind: 'upper', order: 3 },
];

describe('muscle strings', () => {
  it('orders muscles canonically and drops duplicates', () => {
    expect(sortMuscles(['glutes', 'quads', 'glutes'])).toEqual(['quads', 'glutes']);
  });

  it('lowercases everything after the first label', () => {
    expect(muscleList(['glutes', 'quads'])).toBe('Quads, glutes');
    expect(muscleList(['upper_back', 'lats'])).toBe('Lats, upper back');
    expect(muscleList([])).toBe('');
  });

  it('splits a row line into its primary and secondary halves', () => {
    expect(muscleSummary(makeEntry())).toEqual({
      primary: 'Quads',
      secondary: 'Glutes, adductors',
    });
  });

  it('spells the small print, with a per-side note only when unilateral', () => {
    expect(entryMeta(makeEntry())).toBe('Machine · Squat');
    expect(entryMeta(makeEntry({ unilateral: true }))).toBe('Machine · Squat · each side');
  });
});

describe('programme grouping', () => {
  const rows = [
    makeExercise({ id: 'a', templateId: 'lowerA', catalogId: 'cat_hack' }),
    makeExercise({ id: 'b', templateId: 'lowerB', catalogId: 'cat_hack' }),
    makeExercise({ id: 'c', templateId: 'lowerB', catalogId: 'cat_hack' }),
    makeExercise({ id: 'd', templateId: 'upperA', catalogId: 'cat_row' }),
    makeExercise({ id: 'e', templateId: 'upperA', catalogId: undefined }),
  ];

  it('buckets rows by catalogue id and ignores unlinked ones', () => {
    const grouped = groupByCatalogId(rows);
    expect([...grouped.keys()]).toEqual(['cat_hack', 'cat_row']);
    expect(grouped.get('cat_hack')!.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('names each day once', () => {
    const names = templateNames(TEMPLATES);
    const grouped = groupByCatalogId(rows);
    expect(appearsInLabel(grouped.get('cat_hack'), names)).toBe('in Lower A, Lower B');
    expect(appearsInLabel(grouped.get('cat_row'), names)).toBe('in Upper A');
    expect(appearsInLabel(undefined, names)).toBe('');
    expect(appearsInLabel([], names)).toBe('');
  });

  it('falls back to the raw id for an unknown template', () => {
    const names = new Map<TemplateId, string>();
    expect(appearsInLabel([makeExercise({ templateId: 'upperB' })], names)).toBe('in upperB');
  });
});

describe('filter chips', () => {
  it('offers every split tag exactly once', () => {
    const tags = TAG_FILTER_GROUPS.flatMap((g) => g.tags);
    expect(tags).toHaveLength(new Set(tags).size);
    expect(tags).toContain('legs');
    expect(tags.filter((t) => t === 'legs')).toHaveLength(1);
  });

  it('toggles a single-choice filter off when re-picked', () => {
    expect(toggleFilter<SplitTag>(undefined, 'pull')).toBe('pull');
    expect(toggleFilter<SplitTag>('push', 'pull')).toBe('pull');
    expect(toggleFilter<SplitTag>('pull', 'pull')).toBeUndefined();
  });
});

describe('catalogue draft', () => {
  it('keeps a muscle out of both lists at once', () => {
    let draft = blankCatalogDraft();
    draft = { ...draft, ...toggleMuscle(draft, 'secondary', 'glutes') };
    expect(draft.secondary).toEqual(['glutes']);

    draft = { ...draft, ...toggleMuscle(draft, 'primary', 'glutes') };
    expect(draft.primary).toEqual(['glutes']);
    expect(draft.secondary).toEqual([]);

    draft = { ...draft, ...toggleMuscle(draft, 'primary', 'glutes') };
    expect(draft.primary).toEqual([]);
  });

  it('adds and removes split tags', () => {
    expect(toggleTag(['upper'], 'push')).toEqual(['upper', 'push']);
    expect(toggleTag(['upper', 'push'], 'upper')).toEqual(['push']);
  });

  it('needs a name, and a primary muscle unless it is conditioning', () => {
    const blank = blankCatalogDraft();
    expect(validateCatalogDraft(blank)).toEqual({
      name: 'Give it a name.',
      muscles: expect.any(String),
    });

    const named = { ...blank, name: 'Sled push' };
    expect(validateCatalogDraft(named).name).toBeUndefined();
    expect(validateCatalogDraft(named).muscles).toBeTruthy();

    expect(validateCatalogDraft({ ...named, pattern: 'conditioning' })).toEqual({});
    expect(validateCatalogDraft({ ...named, primary: ['quads'] })).toEqual({});
  });

  it('trims, sorts and de-conflicts on the way to the repo', () => {
    const input = draftToCatalogInput(
      {
        ...blankCatalogDraft(),
        name: '  Hack squat  ',
        primary: ['glutes', 'quads'],
        secondary: ['quads', 'adductors'],
        tags: ['lower', 'lower', 'legs'],
        notes: '   ',
      },
      'cat_hack',
    );
    expect(input.id).toBe('cat_hack');
    expect(input.name).toBe('Hack squat');
    expect(input.primary).toEqual(['quads', 'glutes']);
    expect(input.secondary).toEqual(['adductors']);
    expect(input.tags).toEqual(['lower', 'legs']);
    expect(input.notes).toBeUndefined();
  });

  it('omits the id when creating', () => {
    expect(draftToCatalogInput({ ...blankCatalogDraft(), name: 'New' }).id).toBeUndefined();
  });
});

describe('swapping a movement out', () => {
  it('carries the target when both movements count the same thing', () => {
    const outgoing = makeExercise({ sets: 4, repMin: 8, repMax: 10, type: 'primary' });
    expect(swapOverrides(outgoing, makeEntry({ defaultMeasure: 'reps' }))).toEqual({
      sets: 4,
      repMin: 8,
      repMax: 10,
      type: 'primary',
    });
  });

  it('resets the target when the measure changes', () => {
    const outgoing = makeExercise({ sets: 3, repMin: 8, repMax: 10, type: 'accessory' });
    expect(swapOverrides(outgoing, makeEntry({ defaultMeasure: 'seconds' }))).toEqual({
      sets: 3,
      repMin: 45,
      repMax: 45,
      type: 'accessory',
    });
    expect(swapOverrides(outgoing, makeEntry({ defaultMeasure: 'laps' }))).toEqual({
      sets: 3,
      repMin: 1,
      repMax: 1,
      type: 'accessory',
    });
  });

  it('resets back to reps coming off a timed movement', () => {
    const plank = makeExercise({ measure: 'seconds', repMin: 45, repMax: 60, sets: 3 });
    expect(swapOverrides(plank, makeEntry({ defaultMeasure: 'reps' }))).toMatchObject({
      repMin: 10,
      repMax: 10,
    });
  });
});
