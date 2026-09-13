import { describe, expect, it } from 'vitest';
import { MUSCLE_LABELS } from '../../db/labels';
import { MUSCLES, type CatalogEntry, type Muscle } from '../../db/types';
import {
  candidateEntries,
  classifyMuscles,
  formatBasis,
  formatInRange,
  formatMovementsLabel,
  formatReviewRow,
  formatTarget,
  muscleCoverage,
  splitByProgramme,
  type ReviewRow,
} from './review';

const TARGET = { min: 10, max: 20 };

function row(muscle: Muscle, perWeek: number): ReviewRow {
  return { muscle, label: MUSCLE_LABELS[muscle], perWeek };
}

/** Every muscle at `perWeek`, the way the tally always emits the whole body. */
function wholeBody(perWeek: number, over: Partial<Record<Muscle, number>> = {}): ReviewRow[] {
  return MUSCLES.map((muscle) => row(muscle, over[muscle] ?? perWeek));
}

function entry(id: string, over: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id,
    name: id,
    primary: ['chest'],
    secondary: [],
    equipment: 'barbell',
    pattern: 'horizontal_push',
    unilateral: false,
    tags: ['upper'],
    defaultUnit: 'kg_total',
    defaultMeasure: 'reps',
    ...over,
  };
}

describe('classifyMuscles', () => {
  it('sorts under ascending and over descending', () => {
    const result = classifyMuscles(
      [
        row('chest', 24),
        row('rear_delts', 2.5),
        row('biceps', 8),
        row('lats', 31),
        row('quads', 14),
      ],
      TARGET,
    );
    expect(result.under.map((r) => r.muscle)).toEqual(['rear_delts', 'biceps']);
    expect(result.over.map((r) => r.muscle)).toEqual(['lats', 'chest']);
    expect(result.inRange.map((r) => r.muscle)).toEqual(['quads']);
  });

  it('treats both boundaries as in range', () => {
    const result = classifyMuscles([row('chest', 10), row('lats', 20)], TARGET);
    expect(result.under).toEqual([]);
    expect(result.over).toEqual([]);
    expect(result.inRange).toHaveLength(2);
  });

  it('keeps untrained muscles as zero-set under rows rather than dropping them', () => {
    const result = classifyMuscles(wholeBody(0, { chest: 12 }), TARGET);
    expect(result.under).toHaveLength(MUSCLES.length - 1);
    expect(result.under[0]?.perWeek).toBe(0);
    expect(result.inRange.map((r) => r.muscle)).toEqual(['chest']);
  });

  it('classifies every row exactly once', () => {
    const rows = wholeBody(3, { chest: 25, quads: 15 });
    const { under, over, inRange } = classifyMuscles(rows, TARGET);
    expect(under.length + over.length + inRange.length).toBe(rows.length);
  });

  it('copies rows rather than aliasing the input', () => {
    const rows = [row('chest', 4)];
    const result = classifyMuscles(rows, TARGET);
    expect(result.under[0]).toEqual(rows[0]);
    expect(result.under[0]).not.toBe(rows[0]);
  });
});

describe('splitByProgramme', () => {
  const under = [row('rear_delts', 1), row('calves', 2), row('abductors', 0)];

  it('splits on whether the programme touches the muscle', () => {
    const split = splitByProgramme(under, ['rear_delts', 'calves', 'chest']);
    expect(split.inProgramme.map((r) => r.muscle)).toEqual(['rear_delts', 'calves']);
    expect(split.notInProgramme.map((r) => r.muscle)).toEqual(['abductors']);
  });

  it('keeps the incoming order inside each group', () => {
    const split = splitByProgramme(under, ['abductors']);
    expect(split.notInProgramme.map((r) => r.muscle)).toEqual(['rear_delts', 'calves']);
  });

  it('puts everything in the second group when no programme covers anything', () => {
    const split = splitByProgramme(under, []);
    expect(split.inProgramme).toEqual([]);
    expect(split.notInProgramme).toHaveLength(3);
  });
});

describe('muscleCoverage', () => {
  it('unions primaries and secondaries', () => {
    const covered = muscleCoverage([
      entry('bench', { primary: ['chest'], secondary: ['triceps', 'front_delts'] }),
      entry('row', { primary: ['lats'], secondary: ['biceps'] }),
    ]);
    expect([...covered].sort()).toEqual(
      ['biceps', 'chest', 'front_delts', 'lats', 'triceps'].sort(),
    );
  });

  it('is empty for no entries', () => {
    expect(muscleCoverage([]).size).toBe(0);
  });
});

describe('candidateEntries', () => {
  const entries = [
    entry('facepull', { primary: ['rear_delts'], secondary: ['upper_back'] }),
    entry('reverse-fly', { primary: ['rear_delts'], secondary: [] }),
    entry('row', { primary: ['lats'], secondary: ['rear_delts'] }),
    entry('bench', { primary: ['chest'], secondary: ['triceps'] }),
  ];

  it('keeps entries that train the muscle, primaries first', () => {
    expect(candidateEntries(entries, 'rear_delts', []).map((e) => e.id)).toEqual([
      'facepull',
      'reverse-fly',
      'row',
    ]);
  });

  it('drops entries already in the programme', () => {
    expect(candidateEntries(entries, 'rear_delts', ['facepull']).map((e) => e.id)).toEqual([
      'reverse-fly',
      'row',
    ]);
  });

  it('drops archived entries', () => {
    const withArchived = [...entries, entry('old-fly', { primary: ['rear_delts'], archived: true })];
    expect(candidateEntries(withArchived, 'rear_delts', []).map((e) => e.id)).not.toContain(
      'old-fly',
    );
  });

  it('returns nothing when the muscle is untouched by the library', () => {
    expect(candidateEntries(entries, 'calves', [])).toEqual([]);
  });

  it('counts an entry once even when it lists the muscle twice', () => {
    const both = [entry('shrug', { primary: ['upper_back'], secondary: ['upper_back'] })];
    expect(candidateEntries(both, 'upper_back', [])).toHaveLength(1);
  });
});

describe('strings', () => {
  it('spells the band with an en dash', () => {
    expect(formatTarget(TARGET)).toBe('10–20');
  });

  it('states a muscle, its average and the band', () => {
    expect(formatReviewRow(row('rear_delts', 2.5), TARGET)).toBe(
      'Rear delts · 2.5 sets/week (target 10–20)',
    );
  });

  it('pluralises the in-range line', () => {
    expect(formatInRange(12)).toBe('12 muscles in range.');
    expect(formatInRange(1)).toBe('1 muscle in range.');
  });

  it('pluralises the basis line', () => {
    expect(formatBasis(3)).toBe(
      'Averages over 3 active weeks. Warm-ups excluded. Secondary muscles count half.',
    );
    expect(formatBasis(1)).toContain('over 1 active week.');
  });

  it('lower-cases the muscle in the disclosure label', () => {
    expect(formatMovementsLabel('rear_delts')).toBe('Movements for rear delts');
    expect(formatMovementsLabel('core')).toBe('Movements for core');
  });
});
