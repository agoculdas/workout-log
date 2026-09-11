/**
 * Pure maths for the bodyweight log: the rolling average line and the
 * "this week vs last week" stat. No database, no React.
 */
import type { BodyweightEntry } from '../../db/types';

const DAY_MS = 86_400_000;

/** Local calendar date as YYYY-MM-DD (what `addBodyweight` stores). */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Days since the epoch for a YYYY-MM-DD string; NaN when it is not a date. */
export function dayIndex(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return Number.NaN;
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

/** Midday UTC on that date — a stable x value that never shifts a day on format. */
export function dateToTime(date: string): number {
  const day = dayIndex(date);
  return Number.isNaN(day) ? Number.NaN : day * DAY_MS + DAY_MS / 2;
}

function round(n: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Valid entries, oldest first, one per date (the later row wins). */
export function sortEntries(entries: BodyweightEntry[]): BodyweightEntry[] {
  const byDate = new Map<string, BodyweightEntry>();
  for (const e of entries) {
    if (Number.isNaN(dayIndex(e.date)) || !Number.isFinite(e.kg)) continue;
    byDate.set(e.date, e);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export interface BodyweightPoint {
  date: string;
  /** Days since epoch — numeric x axis, so gaps in logging show as gaps. */
  day: number;
  /** Epoch ms, for date formatting on the axis/tooltip. */
  t: number;
  kg: number;
  /** Trailing mean over the last `window` days, inclusive of this one. */
  avg: number;
}

/**
 * Daily points plus a trailing rolling average (7 days by default). The window
 * is a calendar window, not "the last 7 entries", so skipping days does not
 * stretch the average backwards.
 */
export function buildBodyweightSeries(
  entries: BodyweightEntry[],
  window = 7,
): BodyweightPoint[] {
  const sorted = sortEntries(entries);
  const days = sorted.map((e) => dayIndex(e.date));
  return sorted.map((e, i) => {
    const day = days[i]!;
    const from = day - (window - 1);
    let sum = 0;
    let count = 0;
    for (let j = i; j >= 0; j--) {
      if (days[j]! < from) break;
      sum += sorted[j]!.kg;
      count++;
    }
    return { date: e.date, day, t: dateToTime(e.date), kg: e.kg, avg: round(sum / count) };
  });
}

export interface WeeklyChange {
  /** Mean of the entries in the last 7 days (day 0 = `today`), or null. */
  current: number | null;
  /** Mean of the 7 days before that, or null. */
  previous: number | null;
  /** `current - previous`, or null when either week has no entries. */
  delta: number | null;
  currentCount: number;
  previousCount: number;
}

/**
 * This week's average against last week's. Both windows are seven calendar
 * days wide and anchored on `today`, so a missed day lowers the sample count
 * rather than dragging an older reading into the window.
 */
export function weeklyChange(
  entries: BodyweightEntry[],
  today = toISODate(new Date()),
): WeeklyChange {
  const anchor = dayIndex(today);
  const sorted = sortEntries(entries);
  if (Number.isNaN(anchor) || !sorted.length) {
    return { current: null, previous: null, delta: null, currentCount: 0, previousCount: 0 };
  }

  const mean = (from: number, to: number): { mean: number | null; count: number } => {
    const inWindow = sorted.filter((e) => {
      const d = dayIndex(e.date);
      return d >= from && d <= to;
    });
    if (!inWindow.length) return { mean: null, count: 0 };
    const sum = inWindow.reduce((acc, e) => acc + e.kg, 0);
    return { mean: round(sum / inWindow.length), count: inWindow.length };
  };

  const thisWeek = mean(anchor - 6, anchor);
  const lastWeek = mean(anchor - 13, anchor - 7);

  return {
    current: thisWeek.mean,
    previous: lastWeek.mean,
    delta:
      thisWeek.mean !== null && lastWeek.mean !== null
        ? round(thisWeek.mean - lastWeek.mean, 2)
        : null,
    currentCount: thisWeek.count,
    previousCount: lastWeek.count,
  };
}

/** 82 -> "82.0", 81.95 -> "82.0" — always one decimal, the way scales read. */
export function formatKg(kg: number): string {
  return kg.toFixed(1);
}

/** -0.42 -> "−0.4 kg", 0 -> "±0.0 kg". Uses a real minus sign. */
export function formatDeltaKg(delta: number): string {
  const rounded = round(delta, 1);
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '±';
  return `${sign}${Math.abs(rounded).toFixed(1)} kg`;
}

/** "−0.4 kg vs last week", or null when there is nothing to compare. */
export function describeWeeklyChange(change: WeeklyChange): string | null {
  if (change.delta === null) return null;
  return `${formatDeltaKg(change.delta)} vs last week`;
}
