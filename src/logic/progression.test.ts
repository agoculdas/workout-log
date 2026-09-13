import { describe, expect, it } from 'vitest';
import { suggestLoad, targetReps, setsFromLastSession } from './progression';
import { makeExercise, makeSets, makeWarmup } from './testFixtures';

describe('targetReps', () => {
  it('uses the bottom of the range for ranges', () => {
    expect(targetReps(makeExercise({ repMin: 8, repMax: 10 }))).toBe(8);
  });
  it('uses the fixed number when repMin === repMax', () => {
    expect(targetReps(makeExercise({ repMin: 12, repMax: 12 }))).toBe(12);
  });
});

describe('suggestLoad — no history', () => {
  it('returns a blank load and the rep target', () => {
    const ex = makeExercise({ repMin: 8, repMax: 10 });
    expect(suggestLoad(ex, undefined)).toMatchObject({ load: 0, reps: 8, progressed: false });
    expect(suggestLoad(ex, [])).toMatchObject({ load: 0, reps: 8 });
    expect(suggestLoad(ex, undefined).reason).toBeTruthy();
  });
});

describe('suggestLoad — primary', () => {
  const ex = makeExercise({ sets: 4, repMin: 8, repMax: 10, increment: 5 });

  it('adds the increment when every set hit the top of the range', () => {
    const result = suggestLoad(ex, makeSets('s1', 70, [10, 10, 10, 10]));
    expect(result.load).toBe(75);
    expect(result.progressed).toBe(true);
    expect(result.reps).toBe(8);
  });

  it('repeats the load when one set missed the top', () => {
    const result = suggestLoad(ex, makeSets('s1', 70, [10, 10, 10, 9]));
    expect(result.load).toBe(70);
    expect(result.progressed).toBe(false);
  });

  it('repeats the load when not all planned sets were logged', () => {
    const result = suggestLoad(ex, makeSets('s1', 70, [10, 10, 10]));
    expect(result.load).toBe(70);
    expect(result.progressed).toBe(false);
  });

  it('counts reps above the top of the range as a hit', () => {
    expect(suggestLoad(ex, makeSets('s1', 70, [11, 12, 10, 10])).load).toBe(75);
  });

  it('uses +2.5 for a DB press and reports kg/hand loads raw', () => {
    const db = makeExercise({ unit: 'kg_side', increment: 2.5, sets: 4, repMin: 8, repMax: 10 });
    expect(suggestLoad(db, makeSets('s1', 30, [10, 10, 10, 10])).load).toBe(32.5);
  });

  it('only counts the most recent session when several are passed in', () => {
    const old = makeSets('old', 60, [10, 10, 10, 10], { completedAt: 1_000 });
    const recent = makeSets('new', 70, [8, 8, 8, 8], { completedAt: 2_000_000 });
    const result = suggestLoad(ex, [...old, ...recent]);
    expect(result.load).toBe(70);
    expect(result.progressed).toBe(false);
  });
});

describe('suggestLoad — fixed-rep accessory', () => {
  const ex = makeExercise({
    type: 'accessory',
    sets: 3,
    repMin: 12,
    repMax: 12,
    increment: 2.5,
  });

  it('adds 2.5 once every set hits the fixed target', () => {
    expect(suggestLoad(ex, makeSets('s1', 40, [12, 12, 12])).load).toBe(42.5);
  });

  it('holds when a set falls short', () => {
    expect(suggestLoad(ex, makeSets('s1', 40, [12, 12, 11])).load).toBe(40);
  });

  it('uses +1 per hand for DB laterals / curls', () => {
    const laterals = makeExercise({
      type: 'accessory',
      unit: 'kg_side',
      increment: 1,
      sets: 3,
      repMin: 15,
      repMax: 15,
    });
    expect(suggestLoad(laterals, makeSets('s1', 8, [15, 15, 15])).load).toBe(9);
  });
});

describe('suggestLoad — band / bodyweight (increment 0)', () => {
  it('never adds load for a band exercise, even at the top of the range', () => {
    const band = makeExercise({
      type: 'accessory',
      unit: 'band',
      increment: 0,
      sets: 3,
      repMin: 25,
      repMax: 25,
    });
    const result = suggestLoad(band, makeSets('s1', 0, [25, 25, 25]));
    expect(result).toMatchObject({ load: 0, reps: 25, progressed: false });
    expect(result.reason).toMatch(/band/i);
  });

  it('tracks reps only for bodyweight work', () => {
    const bw = makeExercise({
      type: 'accessory',
      unit: 'bodyweight',
      increment: 0,
      sets: 3,
      repMin: 15,
      repMax: 15,
      perSide: true,
    });
    expect(suggestLoad(bw, makeSets('s1', 0, [15, 15, 15]))).toMatchObject({
      load: 0,
      reps: 15,
      progressed: false,
    });
  });
});

describe('suggestLoad — conditioning', () => {
  const row = makeExercise({
    type: 'conditioning',
    measure: 'seconds',
    unit: 'none',
    increment: 0,
    sets: 1,
    repMin: 0,
    repMax: 0,
  });

  it('starts empty', () => {
    expect(suggestLoad(row, undefined)).toMatchObject({ load: 0, reps: 0 });
  });

  it('pre-fills the last time', () => {
    expect(suggestLoad(row, makeSets('s1', 0, [252]))).toMatchObject({ load: 0, reps: 252 });
  });
});

describe('setsFromLastSession', () => {
  it('keeps only the newest session and sorts by setIndex', () => {
    const old = makeSets('old', 60, [10, 10], { completedAt: 1_000 });
    const recent = makeSets('new', 70, [8, 9], { completedAt: 9_000_000 });
    const result = setsFromLastSession([...recent.slice().reverse(), ...old]);
    expect(result.map((s) => s.sessionId)).toEqual(['new', 'new']);
    expect(result.map((s) => s.setIndex)).toEqual([0, 1]);
  });
});

describe('warm-ups and set facts', () => {
  const ex = makeExercise({ sets: 4, repMin: 8, repMax: 10, increment: 5 });

  it('setsFromLastSession drops warm-ups', () => {
    const sets = [makeWarmup('s2', 40, 10), ...makeSets('s2', 70, [10, 10, 10, 10])];
    const last = setsFromLastSession(sets);
    expect(last).toHaveLength(4);
    expect(last.every((s) => s.kind !== 'warmup')).toBe(true);
  });

  it('suggestLoad ignores a warm-up row', () => {
    const clean = makeSets('s2', 70, [10, 10, 10, 10]);
    const withWarmup = [makeWarmup('s2', 40, 12), ...clean];
    // Without filtering, the 12-rep light warm-up would break "all sets at top"
    // and the 4-set count would be wrong.
    expect(suggestLoad(ex, withWarmup)).toMatchObject({ load: 75, progressed: true });
    expect(suggestLoad(ex, withWarmup)).toEqual(suggestLoad(ex, clean));
  });

  it('toFailure changes nothing about the suggestion', () => {
    const plain = makeSets('s2', 70, [10, 10, 10, 9]);
    const marked = makeSets('s2', 70, [10, 10, 10, 9], { toFailure: true });
    expect(suggestLoad(ex, marked)).toEqual(suggestLoad(ex, plain));
    expect(suggestLoad(ex, marked).progressed).toBe(false);
  });

  it('names the exercise denomination in the reason', () => {
    const lb = makeExercise({ sets: 4, repMin: 8, repMax: 10, increment: 5, massUnit: 'lb' });
    const sets = makeSets('s2', 70, [10, 10, 10, 10], { massUnit: 'lb' });
    expect(suggestLoad(lb, sets).load).toBe(75);
    expect(suggestLoad(lb, sets).reason).toContain('add 5 lb');
    expect(suggestLoad(ex, makeSets('s2', 70, [10, 10, 10, 10])).reason).toContain('add 5 kg');
  });
});
