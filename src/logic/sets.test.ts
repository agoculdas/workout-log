import { describe, expect, it } from 'vitest';
import { warmupSets, workingSets } from './sets';
import { makeSets, makeWarmup } from './testFixtures';

describe('workingSets / warmupSets', () => {
  const working = makeSets('s1', 70, [10, 10]);
  const warmup = makeWarmup('s1', 40, 8);
  const all = [warmup, ...working];

  it('splits the two kinds', () => {
    expect(workingSets(all)).toEqual(working);
    expect(warmupSets(all)).toEqual([warmup]);
  });

  it('treats a row with no kind as a working set', () => {
    expect(workingSets(working)).toHaveLength(2);
    expect(warmupSets(working)).toEqual([]);
  });

  it('handles empty input', () => {
    expect(workingSets([])).toEqual([]);
    expect(warmupSets([])).toEqual([]);
  });
});
