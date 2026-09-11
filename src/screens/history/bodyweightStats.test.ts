import { describe, expect, it } from 'vitest';
import type { BodyweightEntry } from '../../db/types';
import {
  buildBodyweightSeries,
  dayIndex,
  describeWeeklyChange,
  formatDeltaKg,
  formatKg,
  sortEntries,
  toISODate,
  weeklyChange,
} from './bodyweightStats';

function entry(date: string, kg: number): BodyweightEntry {
  return { id: `bw_${date}`, date, kg };
}

describe('toISODate / dayIndex', () => {
  it('formats a local date with zero padding', () => {
    expect(toISODate(new Date(2024, 2, 5))).toBe('2024-03-05');
    expect(toISODate(new Date(2024, 11, 31))).toBe('2024-12-31');
  });

  it('counts whole days between dates', () => {
    expect(dayIndex('2024-03-08') - dayIndex('2024-03-01')).toBe(7);
    expect(dayIndex('2024-03-01') - dayIndex('2024-02-28')).toBe(2); // leap year
  });

  it('returns NaN for junk', () => {
    expect(Number.isNaN(dayIndex('not a date'))).toBe(true);
  });
});

describe('sortEntries', () => {
  it('sorts oldest first and keeps one row per date', () => {
    const rows = sortEntries([
      entry('2024-03-03', 81),
      entry('2024-03-01', 82),
      { id: 'dup', date: '2024-03-01', kg: 83 },
    ]);
    expect(rows.map((r) => r.date)).toEqual(['2024-03-01', '2024-03-03']);
    expect(rows[0]!.kg).toBe(83);
  });

  it('drops malformed rows', () => {
    expect(sortEntries([entry('nope', 80), entry('2024-03-01', Number.NaN)])).toEqual([]);
  });
});

describe('buildBodyweightSeries', () => {
  it('averages over a calendar window, not the last N entries', () => {
    const points = buildBodyweightSeries([
      entry('2024-03-01', 80),
      entry('2024-03-02', 82),
      entry('2024-03-03', 84),
    ]);
    expect(points.map((p) => p.kg)).toEqual([80, 82, 84]);
    expect(points.map((p) => p.avg)).toEqual([80, 81, 82]);
  });

  it('forgets readings older than the window', () => {
    const points = buildBodyweightSeries([
      entry('2024-03-01', 90), // 8 days before the last point
      entry('2024-03-08', 80),
      entry('2024-03-09', 82),
    ]);
    expect(points[1]!.avg).toBe(80);
    expect(points[2]!.avg).toBe(81);
  });

  it('honours a custom window', () => {
    const points = buildBodyweightSeries(
      [entry('2024-03-01', 80), entry('2024-03-02', 90), entry('2024-03-03', 100)],
      2,
    );
    expect(points.map((p) => p.avg)).toEqual([80, 85, 95]);
  });

  it('is empty for no entries', () => {
    expect(buildBodyweightSeries([])).toEqual([]);
  });

  it('exposes an increasing numeric day axis', () => {
    const points = buildBodyweightSeries([entry('2024-03-01', 80), entry('2024-03-05', 79)]);
    expect(points[1]!.day - points[0]!.day).toBe(4);
    expect(points[1]!.t).toBeGreaterThan(points[0]!.t);
  });
});

describe('weeklyChange', () => {
  const cut: BodyweightEntry[] = [
    // last week (2024-03-01 .. 2024-03-07 relative to a 2024-03-14 anchor)
    entry('2024-03-02', 82),
    entry('2024-03-05', 82.4),
    // this week (2024-03-08 .. 2024-03-14)
    entry('2024-03-09', 81.6),
    entry('2024-03-13', 82),
  ];

  it('compares the two trailing seven-day windows', () => {
    const change = weeklyChange(cut, '2024-03-14');
    expect(change.previous).toBe(82.2);
    expect(change.current).toBe(81.8);
    expect(change.delta).toBe(-0.4);
    expect(change.currentCount).toBe(2);
    expect(change.previousCount).toBe(2);
  });

  it('describes the delta for the UI', () => {
    expect(describeWeeklyChange(weeklyChange(cut, '2024-03-14'))).toBe(
      '−0.4 kg vs last week',
    );
  });

  it('has no delta when a week is empty', () => {
    const change = weeklyChange([entry('2024-03-13', 82)], '2024-03-14');
    expect(change.current).toBe(82);
    expect(change.previous).toBeNull();
    expect(change.delta).toBeNull();
    expect(describeWeeklyChange(change)).toBeNull();
  });

  it('ignores readings outside both windows', () => {
    const change = weeklyChange([...cut, entry('2024-01-01', 95)], '2024-03-14');
    expect(change.previous).toBe(82.2);
  });

  it('is empty with no entries at all', () => {
    expect(weeklyChange([], '2024-03-14')).toEqual({
      current: null,
      previous: null,
      delta: null,
      currentCount: 0,
      previousCount: 0,
    });
  });
});

describe('formatting', () => {
  it('always shows one decimal', () => {
    expect(formatKg(82)).toBe('82.0');
    expect(formatKg(81.95)).toBe('82.0');
  });

  it('signs deltas with a real minus sign', () => {
    expect(formatDeltaKg(-0.42)).toBe('−0.4 kg');
    expect(formatDeltaKg(0.4)).toBe('+0.4 kg');
    expect(formatDeltaKg(0)).toBe('±0.0 kg');
  });
});
