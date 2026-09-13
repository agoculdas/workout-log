import { describe, expect, it } from 'vitest';
import {
  averageLoad,
  setCount,
  topSetLoad,
  totalReps,
  totalVolume,
  totalVolumeKg,
} from './volume';
import { makeSets, makeWarmup } from './testFixtures';

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

describe('warm-ups', () => {
  const working = makeSets('s1', 70, [10, 10]);
  const withWarmup = [makeWarmup('s1', 200, 30), ...working];

  it('are ignored by every volume helper', () => {
    expect(topSetLoad(withWarmup)).toBe(70);
    expect(totalVolume(withWarmup)).toBe(1400);
    expect(totalVolumeKg(withWarmup)).toBe(1400);
    expect(totalReps(withWarmup)).toBe(20);
    expect(averageLoad(withWarmup)).toBe(70);
    expect(setCount(withWarmup)).toBe(2);
  });

  it('leave nothing behind when that is all there is', () => {
    const only = [makeWarmup('s1', 40, 8)];
    expect(topSetLoad(only)).toBe(0);
    expect(totalVolume(only)).toBe(0);
    expect(totalVolumeKg(only)).toBe(0);
    expect(totalReps(only)).toBe(0);
    expect(averageLoad(only)).toBe(0);
    expect(setCount(only)).toBe(0);
  });
});

describe('totalVolumeKg', () => {
  it('matches totalVolume when everything is in kg', () => {
    const sets = makeSets('s1', 70, [10, 10]);
    expect(totalVolumeKg(sets)).toBe(totalVolume(sets));
  });

  it('converts each set by its own stamped unit', () => {
    const kg = makeSets('s1', 100, [10]); // 1000 kg
    const lb = makeSets('s1', 100, [10], { massUnit: 'lb' }); // 1000 lb
    expect(totalVolumeKg(lb)).toBeCloseTo(453.59237, 5);
    expect(totalVolumeKg([...kg, ...lb])).toBeCloseTo(1453.59237, 5);
    // The native-unit total stays unconverted, deliberately.
    expect(totalVolume([...kg, ...lb])).toBe(2000);
  });
});
