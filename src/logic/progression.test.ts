import { describe, expect, it } from 'vitest';
import {
  deloadLoad,
  exerciseScheme,
  setsFromLastSession,
  suggestLoad,
  targetReps,
} from './progression';
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

describe('exerciseScheme', () => {
  it('defaults to double progression for primary and accessory work', () => {
    expect(exerciseScheme(makeExercise({ type: 'primary' }))).toBe('double');
    expect(exerciseScheme(makeExercise({ type: 'accessory' }))).toBe('double');
  });

  it('defaults conditioning to best time', () => {
    expect(exerciseScheme(makeExercise({ type: 'conditioning' }))).toBe('best-time');
  });

  it("takes the exercise's own scheme when it has one", () => {
    expect(exerciseScheme(makeExercise({ scheme: 'linear' }))).toBe('linear');
    expect(exerciseScheme(makeExercise({ type: 'conditioning', scheme: 'none' }))).toBe('none');
  });
});

describe('suggestLoad — linear', () => {
  const ex = makeExercise({ scheme: 'linear', sets: 4, repMin: 8, repMax: 12, increment: 5 });

  it('adds the increment when every set cleared the bottom of the range', () => {
    const result = suggestLoad(ex, makeSets('s1', 100, [8, 8, 9, 8]));
    expect(result).toMatchObject({ load: 105, reps: 8, progressed: true });
    expect(result.reason).toBe('All 4 sets hit at least 8 — add 5 kg.');
  });

  it('holds when one set fell under the bottom of the range', () => {
    const result = suggestLoad(ex, makeSets('s1', 100, [8, 8, 8, 7]));
    expect(result).toMatchObject({ load: 100, progressed: false });
    expect(result.reason).toContain('at least 8');
  });

  it('holds when the planned sets were not all logged', () => {
    expect(suggestLoad(ex, makeSets('s1', 100, [10, 10, 10]))).toMatchObject({
      load: 100,
      progressed: false,
    });
  });

  it('holds when the load moved between sets', () => {
    const drop = [...makeSets('s1', 100, [8, 8]), ...makeSets('s1', 90, [8, 8])];
    expect(suggestLoad(ex, drop)).toMatchObject({ progressed: false });
  });

  it('bumps where double progression would not', () => {
    const sets = makeSets('s1', 100, [8, 8, 8, 8]);
    expect(suggestLoad(ex, sets).progressed).toBe(true);
    expect(suggestLoad({ ...ex, scheme: 'double' }, sets).progressed).toBe(false);
  });
});

describe('suggestLoad — tracking only', () => {
  const ex = makeExercise({ scheme: 'none', sets: 3, repMin: 10, repMax: 10, increment: 5 });

  it('repeats the last load however good the session was', () => {
    const result = suggestLoad(ex, makeSets('s1', 60, [10, 10, 10]));
    expect(result).toMatchObject({ load: 60, reps: 10, progressed: false });
    expect(result.reason).toBe('Tracking only.');
  });

  it('still starts blank with no history', () => {
    expect(suggestLoad(ex, [])).toMatchObject({ load: 0, progressed: false });
  });
});

describe('suggestLoad — best time', () => {
  const row = makeExercise({
    type: 'conditioning',
    measure: 'seconds',
    unit: 'none',
    increment: 0,
    sets: 1,
    repMin: 0,
    repMax: 0,
  });

  it('pre-fills the record when one is passed in', () => {
    const result = suggestLoad(row, makeSets('s1', 0, [260]), { bestTime: 245 });
    expect(result).toMatchObject({ load: 0, reps: 245, progressed: false });
    expect(result.reason).toBe('Best 4:05 — try to beat it.');
  });

  it('falls back to the last time when no record is passed in', () => {
    expect(suggestLoad(row, makeSets('s1', 0, [252]))).toMatchObject({
      reps: 252,
      reason: 'Beat your last time.',
    });
  });

  it('ignores a zero record', () => {
    expect(suggestLoad(row, makeSets('s1', 0, [252]), { bestTime: 0 }).reps).toBe(252);
  });

  it('says nothing but the facts with no history at all', () => {
    expect(suggestLoad(row, undefined, { bestTime: 245 })).toMatchObject({ load: 0, reps: 245 });
    expect(suggestLoad(row, undefined)).toMatchObject({ load: 0, reps: 0 });
  });
});

describe('suggestLoad — stall override', () => {
  const ex = makeExercise({ sets: 4, repMin: 8, repMax: 10, increment: 5 });
  const top = makeSets('s1', 100, [10, 10, 10, 10]);

  it('wins over a session that would otherwise have progressed', () => {
    const override = { load: 90, reps: 8, kind: 'deload' as const, setAt: 1 };
    const result = suggestLoad({ ...ex, override }, top);
    expect(result).toMatchObject({ load: 90, reps: 8, progressed: false });
    expect(result.reason).toBe('Deload — 10% off 100 kg.');
  });

  it('names the bottom of the range for the other answer', () => {
    const override = { load: 100, reps: 8, kind: 'bottom' as const, setAt: 1 };
    expect(suggestLoad({ ...ex, override }, top).reason).toBe(
      'Back to the bottom of the range at 100 kg.',
    );
  });

  it('reads the denomination of the exercise', () => {
    const lb = makeExercise({ massUnit: 'lb', increment: 5 });
    const override = { load: 180, reps: 8, kind: 'deload' as const, setAt: 1 };
    expect(suggestLoad({ ...lb, override }, makeSets('s1', 200, [10])).reason).toContain(
      '10% off 200 lb',
    );
  });

  it('can be passed in explicitly, and beats the stored one', () => {
    const stored = { load: 90, reps: 8, kind: 'deload' as const, setAt: 1 };
    const passed = { load: 80, reps: 8, kind: 'deload' as const, setAt: 2 };
    expect(suggestLoad({ ...ex, override: stored }, top, { override: passed }).load).toBe(80);
  });

  it('falls back to the override load when there is no history to come off', () => {
    const override = { load: 90, reps: 8, kind: 'deload' as const, setAt: 1 };
    expect(suggestLoad({ ...ex, override }, []).reason).toBe('Deload — 10% off 90 kg.');
  });
});

describe('suggestLoad — load set in the programme', () => {
  const ex = makeExercise({ sets: 4, repMin: 8, repMax: 10, increment: 5 });

  it('pre-fills the starting load when there is no history', () => {
    const result = suggestLoad({ ...ex, startLoad: 80 }, undefined);
    expect(result).toMatchObject({ load: 80, reps: 8, progressed: false });
    expect(result.reason).toBe('Starting load from your programme.');
    expect(suggestLoad({ ...ex, startLoad: 80 }, [])).toMatchObject({ load: 80 });
  });

  it('is never read once a session has been logged', () => {
    const logged = suggestLoad({ ...ex, startLoad: 80 }, makeSets('s1', 70, [10, 10, 10, 10]));
    expect(logged.load).toBe(75);
    expect(logged.progressed).toBe(true);
  });

  it('applies on the tracking-only scheme too', () => {
    const row = { ...ex, scheme: 'none' as const, startLoad: 60 };
    expect(suggestLoad(row, undefined)).toMatchObject({
      load: 60,
      reason: 'Starting load from your programme.',
    });
  });

  it('stays out of the way of conditioning, which has no load', () => {
    const row = makeExercise({ type: 'conditioning', unit: 'none', startLoad: 60 });
    expect(suggestLoad(row, undefined).load).toBe(0);
    expect(suggestLoad({ ...row, scheme: 'none' }, undefined).load).toBe(0);
  });

  it('is beaten by a standing override, and ignored when 0', () => {
    const override = { load: 70, reps: 8, kind: 'manual' as const, setAt: 1 };
    expect(suggestLoad({ ...ex, startLoad: 80, override }, undefined).load).toBe(70);
    expect(suggestLoad({ ...ex, startLoad: 0 }, undefined).reason).toBe(
      'No history yet — enter what you lift.',
    );
  });

  it('names the Programme when a hand-set load is standing', () => {
    const override = { load: 82.5, reps: 8, kind: 'manual' as const, setAt: 1 };
    const result = suggestLoad({ ...ex, override }, makeSets('s1', 80, [10, 10, 10, 10]));
    expect(result).toMatchObject({ load: 82.5, reps: 8, progressed: false });
    expect(result.reason).toBe('Set in Programme — 82.5 kg.');
  });

  it('reads the exercise denomination in that reason', () => {
    const lb = makeExercise({ massUnit: 'lb', increment: 5 });
    const override = { load: 180, reps: 8, kind: 'manual' as const, setAt: 1 };
    expect(suggestLoad({ ...lb, override }, undefined).reason).toBe(
      'Set in Programme — 180 lb.',
    );
  });
});

describe('deloadLoad', () => {
  it('takes a tenth off, snapped to the exercise step', () => {
    expect(deloadLoad({ increment: 5 }, 100)).toBe(90);
    expect(deloadLoad({ increment: 2.5 }, 65)).toBe(57.5);
    expect(deloadLoad({ increment: 1 }, 33)).toBe(30);
  });

  it('falls back to 2.5 when the exercise has no step', () => {
    expect(deloadLoad({ increment: 0 }, 100)).toBe(90);
    expect(deloadLoad({ increment: 0 }, 63)).toBe(57.5);
  });
});
