/**
 * The month grid behind History's calendar. Pure: no Dexie, no React.
 *
 * Weeks start on Monday, the way the rest of the app counts them (see
 * `weekStart` in `logic/muscleVolume`). Days are local calendar days — a
 * session finished at 23:30 belongs to that evening, not to UTC's tomorrow.
 */
import { toISODate } from '../../logic/bodyweight';
import type { Session } from '../../db/types';

/** One cell of the grid. */
export interface DayCell {
  /** Local calendar date, YYYY-MM-DD — the key `sessionsByDay` uses. */
  date: string;
  /** Day of the month, 1–31. */
  day: number;
  /** False for the days that pad the first and last weeks out. */
  inMonth: boolean;
  /** Local midnight on that day, epoch ms. */
  ts: number;
}

export interface MonthGrid {
  year: number;
  /** Month index, 0 = January (the same convention as `Date`). */
  month: number;
  /** Whole Monday-first weeks covering the month: four to six of them. */
  weeks: DayCell[][];
}

/** Column headings, Monday first. */
export const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;

function cell(date: Date, month: number): DayCell {
  return {
    date: toISODate(date),
    day: date.getDate(),
    inMonth: date.getMonth() === month,
    ts: date.getTime(),
  };
}

/**
 * The weeks of one month, padded at both ends so every row is seven days.
 * `month` is a 0-based index and is normalised, so `monthGrid(2026, 12)` is
 * January 2027 — which is what makes `shiftMonth` a one-liner.
 */
export function monthGrid(year: number, month: number): MonthGrid {
  const first = new Date(year, month, 1);
  const normalYear = first.getFullYear();
  const normalMonth = first.getMonth();

  // Monday = 0 … Sunday = 6.
  const lead = (first.getDay() + 6) % 7;
  const last = new Date(normalYear, normalMonth + 1, 0);
  const rows = Math.ceil((lead + last.getDate()) / 7);

  const weeks: DayCell[][] = [];
  for (let row = 0; row < rows; row++) {
    const week: DayCell[] = [];
    for (let col = 0; col < 7; col++) {
      // Day-of-month offsets either side of the 1st; `Date` normalises them
      // into the neighbouring months for us.
      week.push(cell(new Date(normalYear, normalMonth, 1 - lead + row * 7 + col), normalMonth));
    }
    weeks.push(week);
  }
  return { year: normalYear, month: normalMonth, weeks };
}

/** `delta` months away, normalised across year boundaries. */
export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

/** "September 2026" — the calendar's own heading. */
export function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

/** The local day a session belongs to: when it ended, else when it started. */
export function sessionDay(session: Pick<Session, 'startedAt' | 'finishedAt'>): string {
  return toISODate(new Date(session.finishedAt ?? session.startedAt));
}

/**
 * Sessions keyed by their local day, in the order they were handed over. Used
 * to mark trained days and to filter the list to one of them; nothing here
 * counts runs of days, and nothing scales a colour by how hard you went.
 */
export function sessionsByDay<T extends Pick<Session, 'startedAt' | 'finishedAt'>>(
  sessions: readonly T[],
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const session of sessions) {
    const key = sessionDay(session);
    const list = out.get(key);
    if (list) list.push(session);
    else out.set(key, [session]);
  }
  return out;
}

/** "12 Sep" — what the "Showing …" line calls the day being filtered to. */
export function formatDayLabel(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(
    undefined,
    { day: 'numeric', month: 'short' },
  );
}
