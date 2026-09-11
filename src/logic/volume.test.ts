import { describe, expect, it } from 'vitest';
import { averageLoad, setCount, topSetLoad, totalReps, totalVolume } from './volume';
import { makeSets } from './testFixtures';

describe('volume helpers', () => {
  const sets = makeSets('s1', 70, [10, 9, 8]);

  it('topSetLoad returns the heaviest load', () => {
    expect(topSetLoad(sets)).toBe(70);
    expect(topSetLoad([...sets, ...makeSets('s1', 80, [5])])).toBe(80);
    expect(topSetLoad([])).toBe(0);
  });

  it('totalReps sums the reps field', () => {
    expect(totalReps(sets)).toBe(27);
    expect(totalReps([])).toBe(0);
  });

  it('totalVolume sums load × reps with raw kg_side numbers', () => {
    expect(totalVolume(sets)).toBe(70 * 27);
    expect(totalVolume(makeSets('s1', 30, [10, 10]))).toBe(600);
    expect(totalVolume([])).toBe(0);
  });

  it('totalVolume handles mixed loads', () => {
    expect(totalVolume([...makeSets('s1', 60, [10]), ...makeSets('s1', 80, [5])])).toBe(1000);
  });

  it('averageLoad and setCount', () => {
    expect(averageLoad([...makeSets('s1', 60, [10]), ...makeSets('s1', 80, [10])])).toBe(70);
    expect(averageLoad([])).toBe(0);
    expect(setCount(sets)).toBe(3);
  });
});
