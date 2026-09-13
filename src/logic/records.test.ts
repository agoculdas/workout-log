import { describe, expect, it } from 'vitest';
import {
  computeRecords,
  epley1RM,
  formatRecord,
  recordKindsFor,
  setBeats,
  type ExerciseRecords,
} from './records';
import { makeExercise, makeSets, makeWarmup } from './testFixtures';
import type { ExerciseSessionHistory, Session, SetLog } from '../db/types';

const DAY = 86_400_000;
const T0 = 1_700_000_000_000;

/** One completed session's worth of history for the exercise under test. */
function session(id: string, day: number, sets: SetLog[]): ExerciseSessionHistory {
  const startedAt = T0 + day * DAY;
  const row: Session = {
    id,
    templateId: 'lowerA',
    startedAt,
    finishedAt: startedAt + 3_600_000,
  };
  return { session: row, sets };
}

/** Sets for `sessionId`, stamped on the same day so `at` is comparable. */
function setsOn(
  sessionId: string,
  day: number,
  load: number,
  reps: number[],
  opts: Parameters<typeof makeSets>[3] = {},
): SetLog[] {
  return makeSets(sessionId, load, reps, { completedAt: T0 + day * DAY, ...opts });
}

describe('epley1RM', () => {
  it('is load x (1 + reps / 30)', () => {
    expect(epley1RM(100, 5)).toBeCloseTo(116.6667, 4);
    expect(epley1RM(100, 1)).toBeCloseTo(103.3333, 4);
    expect(epley1RM(60, 10)).toBeCloseTo(80, 6);
  });

  it('is 0 for a set that cannot estimate anything', () => {
    expect(epley1RM(0, 8)).toBe(0);
    expect(epley1RM(100, 0)).toBe(0);
    expect(epley1RM(Number.NaN, 5)).toBe(0);
  });
});

describe('recordKindsFor', () => {
  it('gives loaded rep work an e1RM, a heaviest set and a session volume', () => {
    expect(recordKindsFor(makeExercise())).toEqual(['e1rm', 'heaviest', 'bestVolume']);
  });

  it('gives band / bodyweight rep work reps only', () => {
    expect(recordKindsFor(makeExercise({ unit: 'bodyweight', increment: 0 }))).toEqual([
      'mostReps',
    ]);
    expect(recordKindsFor(makeExercise({ unit: 'band', increment: 0 }))).toEqual(['mostReps']);
  });

  it('gives a hold its longest, loaded or not', () => {
    expect(
      recordKindsFor(makeExercise({ unit: 'bodyweight', measure: 'seconds', increment: 0 })),
    ).toEqual(['longest']);
    expect(recordKindsFor(makeExercise({ measure: 'seconds' }))).toEqual([
      'heaviest',
      'longest',
    ]);
  });

  it('gives timed conditioning a best time and nothing else', () => {
    expect(
      recordKindsFor(
        makeExercise({ type: 'conditioning', measure: 'seconds', unit: 'none', increment: 0 }),
      ),
    ).toEqual(['bestTime']);
  });

  it('gives a loaded carry its heaviest', () => {
    expect(recordKindsFor(makeExercise({ measure: 'laps', unit: 'kg_side' }))).toEqual([
      'heaviest',
    ]);
  });
});

describe('computeRecords', () => {
  const exercise = makeExercise();

  it('has nothing to report without history', () => {
    expect(computeRecords(exercise, [])).toEqual({});
  });

  it('takes the best set and the best session across the history', () => {
    const records = computeRecords(exercise, [
      session('s1', 0, setsOn('s1', 0, 100, [8, 8, 8])),
      session('s2', 2, [
        ...setsOn('s2', 2, 100, [10]),
        ...setsOn('s2', 2, 105, [8], { completedAt: T0 + 2 * DAY + 600_000 }),
      ]),
    ]);

    // 100 x 10 estimates 133.3, just ahead of 105 x 8's 133.
    expect(records.e1rm).toMatchObject({ sessionId: 's2', load: 100, reps: 10 });
    expect(records.e1rm?.value).toBeCloseTo(133.3333, 4);
    expect(records.heaviest).toMatchObject({ value: 105, reps: 8, sessionId: 's2' });
    // Session 2 moved more weight per set but did fewer: 1,840 against 2,400.
    expect(records.bestVolume).toMatchObject({ value: 2400, sessionId: 's1' });
  });

  it('ignores warm-ups', () => {
    const records = computeRecords(exercise, [
      session('s1', 0, [makeWarmup('s1', 200, 5), ...setsOn('s1', 0, 100, [8])]),
    ]);
    expect(records.heaviest).toMatchObject({ value: 100, reps: 8 });
    expect(records.bestVolume?.value).toBe(800);
  });

  it('keeps the earlier session when a number is only matched', () => {
    const records = computeRecords(exercise, [
      session('s1', 0, setsOn('s1', 0, 100, [8])),
      session('s2', 2, setsOn('s2', 2, 100, [8])),
    ]);
    expect(records.heaviest?.sessionId).toBe('s1');
    expect(records.e1rm?.sessionId).toBe('s1');
    expect(records.bestVolume?.sessionId).toBe('s1');
  });

  it('lets equal load with more reps take the heaviest record', () => {
    const records = computeRecords(exercise, [
      session('s1', 0, setsOn('s1', 0, 100, [8])),
      session('s2', 2, setsOn('s2', 2, 100, [10])),
    ]);
    expect(records.heaviest).toMatchObject({ value: 100, reps: 10, sessionId: 's2' });
  });

  it('never sets a heaviest off a zero-load set', () => {
    const records = computeRecords(exercise, [session('s1', 0, setsOn('s1', 0, 0, [8, 8]))]);
    expect(records.heaviest).toBeUndefined();
    expect(records.e1rm).toBeUndefined();
    expect(records.bestVolume).toBeUndefined();
  });

  it('reads every set in the exercise’s current denomination', () => {
    // The exercise moved to a machine marked in lb; the old sets stay in kg.
    const lb = makeExercise({ massUnit: 'lb', increment: 5 });
    const records = computeRecords(lb, [
      session('s1', 0, setsOn('s1', 0, 100, [5], { massUnit: 'kg' })),
      session('s2', 2, setsOn('s2', 2, 200, [5], { massUnit: 'lb' })),
    ]);
    // 100 kg is 220.46 lb, so the kg session still holds the record.
    expect(records.heaviest?.sessionId).toBe('s1');
    expect(records.heaviest?.value).toBeCloseTo(220.462, 3);
    expect(records.bestVolume?.sessionId).toBe('s1');
  });

  it('counts reps for band and bodyweight work', () => {
    const bw = makeExercise({ unit: 'bodyweight', increment: 0 });
    const records = computeRecords(bw, [
      session('s1', 0, setsOn('s1', 0, 0, [12, 11])),
      session('s2', 2, setsOn('s2', 2, 0, [14, 10])),
    ]);
    expect(records.mostReps).toMatchObject({ value: 14, sessionId: 's2' });
    expect(records.heaviest).toBeUndefined();
    expect(records.bestVolume).toBeUndefined();
  });

  it('counts the longest hold', () => {
    const plank = makeExercise({
      unit: 'bodyweight',
      measure: 'seconds',
      increment: 0,
      repMin: 45,
      repMax: 45,
    });
    const records = computeRecords(plank, [
      session('s1', 0, setsOn('s1', 0, 0, [45, 50])),
      session('s2', 2, setsOn('s2', 2, 0, [60, 40])),
    ]);
    expect(records.longest).toMatchObject({ value: 60, sessionId: 's2' });
  });

  it('takes the lowest time for conditioning', () => {
    const row = makeExercise({
      type: 'conditioning',
      measure: 'seconds',
      unit: 'none',
      increment: 0,
      name: 'Row 1 km',
    });
    const records = computeRecords(row, [
      session('s1', 0, setsOn('s1', 0, 0, [260])),
      session('s2', 2, setsOn('s2', 2, 0, [245])),
      session('s3', 4, setsOn('s3', 4, 0, [250])),
    ]);
    expect(records.bestTime).toMatchObject({ value: 245, sessionId: 's2' });
    expect(records.longest).toBeUndefined();
  });

  it('skips a session of nothing but warm-ups', () => {
    const records = computeRecords(exercise, [
      session('s1', 0, [makeWarmup('s1', 60, 5), makeWarmup('s1', 80, 3)]),
    ]);
    expect(records).toEqual({});
  });
});

describe('setBeats', () => {
  const exercise = makeExercise();
  const priors = computeRecords(exercise, [session('s1', 0, setsOn('s1', 0, 100, [8, 8, 8]))]);
  const set = (load: number, reps: number, patch: Partial<SetLog> = {}): SetLog => ({
    ...setsOn('s2', 2, load, [reps])[0]!,
    ...patch,
  });

  it('claims nothing on the first session of an exercise', () => {
    const empty: ExerciseRecords = {};
    expect(setBeats(exercise, empty, set(200, 10))).toEqual([]);
  });

  it('flags a heavier set on both counts', () => {
    expect(setBeats(exercise, priors, set(110, 6))).toEqual(['e1rm', 'heaviest']);
  });

  it('counts equal load with more reps as the heavier set', () => {
    expect(setBeats(exercise, priors, set(100, 10))).toEqual(['e1rm', 'heaviest']);
    // Same load, fewer reps: neither record moves.
    expect(setBeats(exercise, priors, set(100, 6))).toEqual([]);
  });

  it('flags the estimate alone when the set is lighter but stronger', () => {
    // 95 x 12 estimates 133 against 100 x 8's 126.7, and 95 kg is not heavier.
    expect(setBeats(exercise, priors, set(95, 12))).toEqual(['e1rm']);
  });

  it('needs a strictly better number', () => {
    expect(setBeats(exercise, priors, set(100, 8))).toEqual([]);
    expect(setBeats(exercise, priors, set(99, 8))).toEqual([]);
  });

  it('ignores warm-ups whatever the numbers say', () => {
    expect(setBeats(exercise, priors, set(200, 10, { kind: 'warmup' }))).toEqual([]);
  });

  it('leaves the e1RM out above 12 reps', () => {
    // 100 x 20 estimates 166.7, but a set of 20 is not a strength estimate.
    expect(setBeats(exercise, priors, set(100, 20))).toEqual(['heaviest']);
  });

  it('compares across denominations', () => {
    const lb = makeExercise({ massUnit: 'lb', increment: 5 });
    const records = computeRecords(lb, [
      session('s1', 0, setsOn('s1', 0, 100, [8], { massUnit: 'kg' })),
    ]);
    // 200 lb is under 100 kg; 230 lb is over it.
    expect(setBeats(lb, records, set(200, 8, { massUnit: 'lb' }))).toEqual([]);
    expect(setBeats(lb, records, set(230, 8, { massUnit: 'lb' }))).toEqual(['e1rm', 'heaviest']);
  });

  it('wants a lower time for conditioning', () => {
    const row = makeExercise({
      type: 'conditioning',
      measure: 'seconds',
      unit: 'none',
      increment: 0,
    });
    const records = computeRecords(row, [session('s1', 0, setsOn('s1', 0, 0, [260]))]);
    expect(setBeats(row, records, set(0, 245))).toEqual(['bestTime']);
    expect(setBeats(row, records, set(0, 270))).toEqual([]);
  });

  it('flags more reps on bodyweight work', () => {
    const bw = makeExercise({ unit: 'bodyweight', increment: 0 });
    const records = computeRecords(bw, [session('s1', 0, setsOn('s1', 0, 0, [12]))]);
    expect(setBeats(bw, records, set(0, 13))).toEqual(['mostReps']);
    expect(setBeats(bw, records, set(0, 12))).toEqual([]);
  });
});

describe('formatRecord', () => {
  const exercise = makeExercise();
  const records = computeRecords(exercise, [
    session('s1', 0, setsOn('s1', 0, 100, [5, 5, 5, 5, 5])),
  ]);

  it('writes an estimate with the set behind it', () => {
    expect(formatRecord(exercise, 'e1rm', records.e1rm!)).toBe('117 kg e1RM (100 × 5)');
  });

  it('writes the heaviest set', () => {
    expect(formatRecord(exercise, 'heaviest', records.heaviest!)).toBe('100 kg × 5');
  });

  it('writes session volume with a thousands separator', () => {
    expect(formatRecord(exercise, 'bestVolume', records.bestVolume!)).toBe('2,500 kg');
  });

  it('says per-hand loads per hand', () => {
    const db = makeExercise({ unit: 'kg_side', massUnit: 'lb', increment: 5 });
    const rows = computeRecords(db, [
      session('s1', 0, setsOn('s1', 0, 30, [8], { massUnit: 'lb' })),
    ]);
    expect(formatRecord(db, 'heaviest', rows.heaviest!)).toBe('30 lb/hand × 8');
    expect(formatRecord(db, 'bestVolume', rows.bestVolume!)).toBe('240 lb');
  });

  it('writes reps, holds and times', () => {
    const bw = makeExercise({ unit: 'bodyweight', increment: 0 });
    const bwRecords = computeRecords(bw, [session('s1', 0, setsOn('s1', 0, 0, [22]))]);
    expect(formatRecord(bw, 'mostReps', bwRecords.mostReps!)).toBe('22 reps');

    const plank = makeExercise({ unit: 'bodyweight', measure: 'seconds', increment: 0 });
    const plankRecords = computeRecords(plank, [session('s1', 0, setsOn('s1', 0, 0, [60]))]);
    expect(formatRecord(plank, 'longest', plankRecords.longest!)).toBe('60 s');

    const row = makeExercise({
      type: 'conditioning',
      measure: 'seconds',
      unit: 'none',
      increment: 0,
    });
    const rowRecords = computeRecords(row, [session('s1', 0, setsOn('s1', 0, 0, [245]))]);
    expect(formatRecord(row, 'bestTime', rowRecords.bestTime!)).toBe('4:05');
  });
});
