import { describe, expect, it } from 'vitest';
import { bodyweightAt, toISODate } from './bodyweight';
import type { BodyweightEntry } from '../db/types';

function entry(date: string, kg: number): BodyweightEntry {
  return { id: date, date, kg };
}

/** Local noon on that date, so the local-date maths never lands a day out. */
function at(y: number, m: number, d: number, hour = 12): number {
  return new Date(y, m - 1, d, hour).getTime();
}

const log = [entry('2026-09-01', 84), entry('2026-09-08', 83.2), entry('2026-09-12', 82.6)];

describe('toISODate', () => {
  it('formats the local calendar date', () => {
    expect(toISODate(new Date(2026, 8, 5, 23, 30))).toBe('2026-09-05');
    expect(toISODate(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01');
  });
});

describe('bodyweightAt', () => {
  it('takes the entry logged on the day itself', () => {
    expect(bodyweightAt(log, at(2026, 9, 8))).toBe(83.2);
  });

  it('falls back to the most recent earlier entry', () => {
    expect(bodyweightAt(log, at(2026, 9, 10))).toBe(83.2);
    expect(bodyweightAt(log, at(2026, 9, 30))).toBe(82.6);
  });

  it('never reads a later weigh-in backwards', () => {
    expect(bodyweightAt(log, at(2026, 8, 31))).toBeUndefined();
  });

  it('does not care what order the entries arrive in', () => {
    expect(bodyweightAt([...log].reverse(), at(2026, 9, 10))).toBe(83.2);
  });

  it('ignores malformed rows', () => {
    const messy = [entry('not-a-date', 99), entry('2026-09-02', Number.NaN), ...log];
    expect(bodyweightAt(messy, at(2026, 9, 3))).toBe(84);
  });

  it('is undefined with no entries at all', () => {
    expect(bodyweightAt([], at(2026, 9, 3))).toBeUndefined();
    expect(bodyweightAt(log, Number.NaN)).toBeUndefined();
  });
});
