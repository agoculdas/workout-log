import { describe, expect, it } from 'vitest';
import { bucketByWeek, tallyMuscles, weekStart } from './muscleVolume';
import type { CatalogEntry } from '../db/types';

const entry = (over: Partial<CatalogEntry>): CatalogEntry => ({
  id: 'cat_x',
  name: 'X',
  primary: [],
  secondary: [],
  equipment: 'machine',
  pattern: 'isolation',
  unilateral: false,
  tags: [],
  defaultUnit: 'kg_total',
  defaultMeasure: 'reps',
  ...over,
});

/** Local midnight, so the tests read the same in every timezone. */
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe('weekStart', () => {
  it('snaps back to Monday midnight by default', () => {
    // 2024-05-15 is a Wednesday; the week starts Monday the 13th.
    expect(weekStart(at(2024, 5, 15))).toBe(at(2024, 5, 13, 0));
    expect(weekStart(at(2024, 5, 13, 0))).toBe(at(2024, 5, 13, 0));
    // Sunday belongs to the week that started six days earlier.
    expect(weekStart(at(2024, 5, 19, 23))).toBe(at(2024, 5, 13, 0));
  });

  it('honours a Sunday week start', () => {
    expect(weekStart(at(2024, 5, 15), 0)).toBe(at(2024, 5, 12, 0));
    expect(weekStart(at(2024, 5, 19, 23), 0)).toBe(at(2024, 5, 19, 0));
  });

  it('is idempotent', () => {
    const once = weekStart(at(2024, 5, 15));
    expect(weekStart(once)).toBe(once);
  });
});

describe('bucketByWeek', () => {
  const now = at(2024, 5, 15);

  it('returns one bucket per week, oldest first, empties included', () => {
    const buckets = bucketByWeek([], 4, now);
    expect(buckets).toHaveLength(4);
    expect(buckets.map((b) => b.start)).toEqual([
      at(2024, 4, 22, 0),
      at(2024, 4, 29, 0),
      at(2024, 5, 6, 0),
      at(2024, 5, 13, 0),
    ]);
    expect(buckets[0]!.end).toBe(buckets[1]!.start);
    expect(buckets[3]!.end).toBe(at(2024, 5, 20, 0));
    expect(buckets.every((b) => b.sets.length === 0)).toBe(true);
  });

  it('drops sets outside the range and puts the rest in their week', () => {
    const sets = [
      { completedAt: at(2024, 5, 14), id: 'this-week' },
      { completedAt: at(2024, 5, 19, 23), id: 'sunday-this-week' },
      { completedAt: at(2024, 5, 7), id: 'last-week' },
      { completedAt: at(2024, 3, 1), id: 'too-old' },
      { completedAt: at(2024, 6, 1), id: 'in-the-future' },
    ];
    const buckets = bucketByWeek(sets, 4, now);
    expect(buckets.map((b) => b.sets.map((s) => s.id))).toEqual([
      [],
      [],
      ['last-week'],
      ['this-week', 'sunday-this-week'],
    ]);
  });

  it('returns nothing for a zero-week window', () => {
    expect(bucketByWeek([{ completedAt: now }], 0, now)).toEqual([]);
  });
});

describe('tallyMuscles', () => {
  const squat = entry({
    id: 'cat_squat',
    primary: ['quads'],
    secondary: ['glutes', 'adductors'],
  });
  const curl = entry({ id: 'cat_curl', primary: ['hamstrings'], secondary: ['quads'] });

  const resolve = (exerciseId: string): CatalogEntry | undefined => {
    if (exerciseId === 'ex_squat') return squat;
    if (exerciseId === 'ex_curl') return curl;
    return undefined;
  };

  const row = (result: ReturnType<typeof tallyMuscles>, muscle: string) =>
    result.rows.find((r) => r.muscle === muscle)!;

  it('counts primaries 1 and secondaries 0.5', () => {
    const result = tallyMuscles(
      [
        { sessionId: 's1', exerciseId: 'ex_squat' },
        { sessionId: 's1', exerciseId: 'ex_squat' },
        { sessionId: 's2', exerciseId: 'ex_curl' },
      ],
      resolve,
    );
    expect(row(result, 'quads')).toMatchObject({ sets: 2, weightedSets: 2.5, sessions: 2 });
    expect(row(result, 'glutes')).toMatchObject({ sets: 0, weightedSets: 1, sessions: 1 });
    expect(row(result, 'adductors')).toMatchObject({ sets: 0, weightedSets: 1, sessions: 1 });
    expect(row(result, 'hamstrings')).toMatchObject({ sets: 1, weightedSets: 1, sessions: 1 });
    expect(result.unlinkedSets).toBe(0);
  });

  it('reports a row for every muscle, including untrained ones', () => {
    const result = tallyMuscles([{ sessionId: 's1', exerciseId: 'ex_squat' }], resolve);
    expect(result.rows).toHaveLength(17);
    expect(row(result, 'chest')).toMatchObject({ sets: 0, weightedSets: 0, sessions: 0 });
  });

  it('counts sets with no catalogue entry as unlinked, and nowhere else', () => {
    const result = tallyMuscles(
      [
        { sessionId: 's1', exerciseId: 'ex_mystery' },
        { sessionId: 's1', exerciseId: 'ex_mystery' },
        { sessionId: 's1', exerciseId: 'ex_squat' },
      ],
      resolve,
    );
    expect(result.unlinkedSets).toBe(2);
    expect(row(result, 'quads').sets).toBe(1);
  });

  it('never counts a muscle twice for one set', () => {
    const both = entry({ primary: ['chest', 'chest'], secondary: ['chest', 'triceps'] });
    const result = tallyMuscles([{ sessionId: 's1', exerciseId: 'ex_x' }], () => both);
    expect(row(result, 'chest')).toMatchObject({ sets: 1, weightedSets: 1 });
    expect(row(result, 'triceps')).toMatchObject({ sets: 0, weightedSets: 0.5 });
  });
});
