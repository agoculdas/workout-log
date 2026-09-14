import { describe, expect, it } from 'vitest';
import { isStalled, regressionStreak, stallApplies } from './stall';
import { makeSets, makeWarmup } from './testFixtures';

describe('isStalled', () => {
  it('is false with fewer than three sessions', () => {
    expect(isStalled([])).toBe(false);
    expect(isStalled([makeSets('a', 70, [10, 10, 10, 10])])).toBe(false);
    expect(
      isStalled([makeSets('a', 70, [10, 10, 10, 10]), makeSets('b', 70, [9, 9, 9, 9])]),
    ).toBe(false);
  });

  it('is true after two regressions in a row at the same load', () => {
    expect(
      isStalled([
        makeSets('a', 70, [10, 10, 10, 10]),
        makeSets('b', 70, [10, 9, 9, 9]),
        makeSets('c', 70, [9, 8, 8, 8]),
      ]),
    ).toBe(true);
  });

  it('is true when the load also dropped', () => {
    expect(
      isStalled([
        makeSets('a', 70, [10, 10, 10, 10]),
        makeSets('b', 67.5, [10, 9, 9, 9]),
        makeSets('c', 65, [9, 8, 8, 8]),
      ]),
    ).toBe(true);
  });

  it('is false when only the most recent session regressed', () => {
    expect(
      isStalled([
        makeSets('a', 70, [9, 9, 9, 9]),
        makeSets('b', 70, [10, 10, 10, 10]),
        makeSets('c', 70, [9, 9, 9, 9]),
      ]),
    ).toBe(false);
  });

  it('is false when fewer reps came at a heavier load (that is progress)', () => {
    expect(
      isStalled([
        makeSets('a', 70, [10, 10, 10, 10]),
        makeSets('b', 75, [9, 9, 9, 9]),
        makeSets('c', 80, [8, 8, 8, 8]),
      ]),
    ).toBe(false);
  });

  it('is false while total reps hold steady', () => {
    expect(
      isStalled([
        makeSets('a', 70, [10, 10, 10, 10]),
        makeSets('b', 70, [10, 10, 10, 10]),
        makeSets('c', 70, [10, 10, 10, 10]),
      ]),
    ).toBe(false);
  });

  it('ignores sessions with no sets', () => {
    expect(
      isStalled([
        makeSets('a', 70, [10, 10, 10, 10]),
        [],
        makeSets('b', 70, [10, 9, 9, 9]),
        makeSets('c', 70, [9, 8, 8, 8]),
      ]),
    ).toBe(true);
  });
});

describe('regressionStreak', () => {
  it('counts consecutive regressions from the newest session back', () => {
    expect(
      regressionStreak([
        makeSets('a', 70, [10, 10, 10, 10]),
        makeSets('b', 70, [10, 9, 9, 9]),
        makeSets('c', 70, [9, 8, 8, 8]),
      ]),
    ).toBe(2);
    expect(
      regressionStreak([
        makeSets('a', 70, [9, 9, 9, 9]),
        makeSets('b', 70, [10, 10, 10, 10]),
      ]),
    ).toBe(0);
  });
});

describe('warm-ups', () => {
  it('are ignored by isStalled and regressionStreak', () => {
    // A heavy warm-up row in the newest session would otherwise hide the
    // regression (it lifts the top load) — it must not count.
    const history = [
      [...makeSets('a', 70, [10, 10, 10, 10])],
      [...makeSets('b', 70, [10, 9, 9, 9])],
      [makeWarmup('c', 200, 20), ...makeSets('c', 70, [9, 8, 8, 8])],
    ];
    expect(isStalled(history)).toBe(true);
    expect(regressionStreak(history)).toBe(2);
  });

  it('do not make an otherwise empty session count', () => {
    const history = [
      makeSets('a', 70, [10, 10, 10, 10]),
      [makeWarmup('b', 40, 10)],
      makeSets('c', 70, [9, 9, 9, 9]),
    ];
    // Session b holds warm-ups only, so there are two real sessions, not three.
    expect(isStalled(history)).toBe(false);
    expect(regressionStreak(history)).toBe(1);
  });
});

describe('stallApplies', () => {
  it('is true for ordinary rep work, whatever the scheme', () => {
    expect(stallApplies({ type: 'primary' })).toBe(true);
    expect(stallApplies({ type: 'accessory', scheme: 'linear' })).toBe(true);
    expect(stallApplies({ type: 'accessory', scheme: 'none' })).toBe(true);
  });

  it('is false for work scored on the clock', () => {
    // Conditioning defaults to `best-time`, where a falling number is progress.
    expect(stallApplies({ type: 'conditioning' })).toBe(false);
    expect(stallApplies({ type: 'conditioning', scheme: 'none' })).toBe(false);
    // And an imported row that names the scheme without the type.
    expect(stallApplies({ type: 'accessory', scheme: 'best-time' })).toBe(false);
  });
});
