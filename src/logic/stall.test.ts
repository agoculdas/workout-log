import { describe, expect, it } from 'vitest';
import { isStalled, regressionStreak } from './stall';
import { makeSets } from './testFixtures';

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
