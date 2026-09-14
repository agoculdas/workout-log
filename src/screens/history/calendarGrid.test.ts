import { describe, expect, it } from 'vitest';
import {
  formatDayLabel,
  monthGrid,
  sessionDay,
  sessionsByDay,
  shiftMonth,
} from './calendarGrid';
import type { Session } from '../../db/types';

function session(id: string, started: number, finished?: number): Session {
  return {
    id,
    templateId: 'lowerA',
    startedAt: started,
    ...(finished === undefined ? {} : { finishedAt: finished }),
  };
}

/** Local time, so the helpers' local-day maths is what is under test. */
function at(y: number, m: number, d: number, hour = 12): number {
  return new Date(y, m - 1, d, hour).getTime();
}

describe('monthGrid', () => {
  it('covers the month in whole Monday-first weeks', () => {
    // September 2026 starts on a Tuesday and has 30 days.
    const grid = monthGrid(2026, 8);
    expect(grid.weeks).toHaveLength(5);
    for (const week of grid.weeks) expect(week).toHaveLength(7);
    expect(grid.weeks[0]![0]!.date).toBe('2026-08-31');
    expect(grid.weeks[0]![0]!.inMonth).toBe(false);
    expect(grid.weeks[0]![1]!.date).toBe('2026-09-01');
    expect(grid.weeks[0]![1]!.inMonth).toBe(true);
    expect(grid.weeks[4]![6]!.date).toBe('2026-10-04');
  });

  it('needs no padding when the month starts on a Monday and fills its weeks', () => {
    // February 2021: Monday the 1st, 28 days — exactly four weeks.
    const grid = monthGrid(2021, 1);
    expect(grid.weeks).toHaveLength(4);
    expect(grid.weeks[0]![0]!.date).toBe('2021-02-01');
    expect(grid.weeks[3]![6]!.date).toBe('2021-02-28');
    expect(grid.weeks.flat().every((c) => c.inMonth)).toBe(true);
  });

  it('spreads over six rows when a 31-day month starts on a Sunday', () => {
    // August 2026: Saturday the 1st, 31 days. May 2027 starts on a Saturday too.
    const grid = monthGrid(2027, 4);
    expect(grid.weeks).toHaveLength(6);
    expect(grid.weeks[0]![0]!.date).toBe('2027-04-26');
    expect(grid.weeks[5]![6]!.date).toBe('2027-06-06');
  });

  it('lists every day of the month exactly once, in order', () => {
    const grid = monthGrid(2024, 1); // A leap February.
    const own = grid.weeks.flat().filter((c) => c.inMonth);
    expect(own).toHaveLength(29);
    expect(own.map((c) => c.day)).toEqual(Array.from({ length: 29 }, (_, i) => i + 1));
  });

  it('normalises an out-of-range month index', () => {
    expect(monthGrid(2026, 12)).toMatchObject({ year: 2027, month: 0 });
    expect(monthGrid(2026, -1)).toMatchObject({ year: 2025, month: 11 });
  });

  it('gives each cell local midnight', () => {
    const first = monthGrid(2026, 8).weeks[0]![1]!;
    expect(new Date(first.ts).getHours()).toBe(0);
    expect(new Date(first.ts).getDate()).toBe(1);
  });
});

describe('shiftMonth', () => {
  it('walks across year boundaries', () => {
    expect(shiftMonth(2026, 8, 1)).toEqual({ year: 2026, month: 9 });
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth(2026, 8, -12)).toEqual({ year: 2025, month: 8 });
  });
});

describe('sessionsByDay', () => {
  it('keys on the day a session finished', () => {
    const rows = [
      session('a', at(2026, 9, 12, 18), at(2026, 9, 12, 19)),
      session('b', at(2026, 9, 12, 7), at(2026, 9, 12, 8)),
      session('c', at(2026, 9, 14, 9), at(2026, 9, 14, 10)),
    ];
    const byDay = sessionsByDay(rows);
    expect([...byDay.keys()]).toEqual(['2026-09-12', '2026-09-14']);
    expect(byDay.get('2026-09-12')!.map((s) => s.id)).toEqual(['a', 'b']);
    expect(byDay.get('2026-09-14')).toHaveLength(1);
  });

  it('falls back to the start for a session still running', () => {
    expect(sessionDay(session('x', at(2026, 9, 12, 23, )))).toBe('2026-09-12');
    expect(sessionsByDay([session('x', at(2026, 9, 12))]).has('2026-09-12')).toBe(true);
  });

  it('is empty for no sessions', () => {
    expect(sessionsByDay([]).size).toBe(0);
  });
});

describe('formatDayLabel', () => {
  it('reads as a short date', () => {
    expect(formatDayLabel('2026-09-12')).toMatch(/12/);
    expect(formatDayLabel('nonsense')).toBe('nonsense');
  });
});
