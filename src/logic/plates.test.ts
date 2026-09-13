import { describe, expect, it } from 'vitest';
import { platesPerSide } from './plates';

const PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];

describe('platesPerSide', () => {
  it('breaks 100 kg on a 20 kg bar into 25 + 15 per side', () => {
    expect(platesPerSide(100, 20, PLATES)).toEqual({
      perSide: [25, 15],
      total: 100,
      remainder: 0,
      bar: 20,
    });
  });

  it('goes heaviest first and repeats plates', () => {
    const result = platesPerSide(160, 20, PLATES);
    expect(result.perSide).toEqual([25, 25, 20]);
    expect(result.total).toBe(160);
    expect(result.remainder).toBe(0);
  });

  it('reaches the awkward numbers', () => {
    expect(platesPerSide(62.5, 20, PLATES).perSide).toEqual([20, 1.25]);
    expect(platesPerSide(22.5, 20, PLATES).perSide).toEqual([1.25]);
  });

  it('leaves what it cannot load in the remainder', () => {
    const result = platesPerSide(22.5, 20, [25, 20, 15, 10, 5, 2.5]);
    expect(result.perSide).toEqual([]);
    expect(result.total).toBe(20);
    expect(result.remainder).toBe(2.5);
  });

  it('loads nothing at or below the bar', () => {
    expect(platesPerSide(15, 20, PLATES)).toEqual({
      perSide: [],
      total: 20,
      remainder: 0,
      bar: 20,
    });
    expect(platesPerSide(20, 20, PLATES)).toEqual({
      perSide: [],
      total: 20,
      remainder: 0,
      bar: 20,
    });
  });

  it('ignores junk plate sizes and duplicates', () => {
    const result = platesPerSide(70, 20, [20, 20, 0, -5, Number.NaN, 5]);
    expect(result.perSide).toEqual([20, 5]);
    expect(result.total).toBe(70);
  });
});
