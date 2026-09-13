import { describe, expect, it } from 'vitest';
import {
  MIN_WARMUP_REST,
  nextWarmupIndex,
  sortWarmupIndices,
  warmupLabel,
  warmupLoad,
  warmupRest,
} from './warmup';

describe('nextWarmupIndex', () => {
  it('starts at −1', () => {
    expect(nextWarmupIndex([])).toBe(-1);
  });

  it('walks further negative as rows are added', () => {
    expect(nextWarmupIndex([-1])).toBe(-2);
    expect(nextWarmupIndex([-1, -2])).toBe(-3);
  });

  it('ignores working set indices', () => {
    expect(nextWarmupIndex([0, 1, 2])).toBe(-1);
    expect(nextWarmupIndex([0, 1, -1, -2])).toBe(-3);
  });

  it('never reuses an index after a gap', () => {
    // W1 removed, W2 still logged: the next row must not land on −2 again.
    expect(nextWarmupIndex([-2])).toBe(-3);
  });
});

describe('sortWarmupIndices', () => {
  it('puts the first warm-up added on top', () => {
    expect(sortWarmupIndices([-3, -1, -2])).toEqual([-1, -2, -3]);
  });

  it('drops working indices and duplicates', () => {
    expect(sortWarmupIndices([0, -1, -1, 3])).toEqual([-1]);
  });

  it('handles empty input', () => {
    expect(sortWarmupIndices([])).toEqual([]);
  });
});

describe('warmupLabel', () => {
  it('names rows from their index', () => {
    expect(warmupLabel(-1)).toBe('W1');
    expect(warmupLabel(-2)).toBe('W2');
  });
});

describe('warmupLoad', () => {
  it('halves the working suggestion and snaps to the step', () => {
    expect(warmupLoad(100, 2.5)).toBe(50);
    expect(warmupLoad(75, 2.5)).toBe(37.5);
    expect(warmupLoad(70, 5)).toBe(35);
  });

  it('rounds to the nearest available step', () => {
    // 62.5 halved is 31.25, which is not a 2.5 kg multiple — snap to 32.5.
    expect(warmupLoad(65, 2.5)).toBe(32.5);
    expect(warmupLoad(62.5, 2.5)).toBe(32.5);
  });

  it('leaves the value alone when there is no step', () => {
    expect(warmupLoad(30, 0)).toBe(15);
  });

  it('pre-fills nothing without a working load', () => {
    expect(warmupLoad(null, 2.5)).toBeNull();
    expect(warmupLoad(undefined, 2.5)).toBeNull();
    expect(warmupLoad(0, 2.5)).toBeNull();
  });

  it('pre-fills nothing when half a load rounds away to zero', () => {
    expect(warmupLoad(2.5, 5)).toBeNull();
  });
});

describe('warmupRest', () => {
  it('halves the exercise rest', () => {
    expect(warmupRest(120)).toBe(60);
    expect(warmupRest(90)).toBe(45);
  });

  it('never goes below the floor', () => {
    expect(warmupRest(40)).toBe(MIN_WARMUP_REST);
    expect(warmupRest(0)).toBe(MIN_WARMUP_REST);
    expect(warmupRest(Number.NaN)).toBe(MIN_WARMUP_REST);
  });
});
