/**
 * Pure data-shaping for the History → Muscles report.
 *
 * Nothing here touches Dexie or React: the screen reads the rows (set logs,
 * completed sessions, the catalogue entries they point at) and feeds them in.
 * The per-muscle tally itself lives in `logic/muscleVolume.ts` — this module
 * is the window arithmetic, the per-week averaging and the balance ratios.
 */
import { MUSCLE_LABELS } from '../../db/labels';
import type {
  CatalogEntry,
  Exercise,
  Muscle,
  MuscleVolumeResult,
  PatternBalance,
  Session,
  SetLog,
} from '../../db/types';
import { formatDate } from '../../logic/format';
import {
  bucketByWeek,
  tallyMuscles,
  weekStart,
  type TallySet,
  type TimedSet,
} from '../../logic/muscleVolume';

/* ------------------------------------------------------------------ windows */

/** The window chips, shortest first. Weeks always start on Monday. */
export const MUSCLE_WINDOWS = [
  { weeks: 1, label: 'This week' },
  { weeks: 4, label: 'Last 4 weeks' },
  { weeks: 8, label: 'Last 8 weeks' },
] as const;

export type WindowWeeks = (typeof MUSCLE_WINDOWS)[number]['weeks'];

/** Local midnight `days` days after `ts` — DST-safe, unlike `ts + days * DAY`. */
function addDays(ts: number, days: number): number {
  const date = new Date(ts);
  date.setDate(date.getDate() + days);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Local midnight starting the oldest week of a `weeks`-long window ending with
 * the week containing `now` — the `from` to hand `getMuscleVolume()`.
 */
export function windowStart(weeks: number, now: number): number {
  const count = Math.max(1, Math.floor(weeks));
  return addDays(weekStart(now), -7 * (count - 1));
}

/* ---------------------------------------------------------------- resolution */

/** A set as far as both the week bucketing and the muscle tally are concerned. */
export interface MuscleSet extends TimedSet, TallySet {}

/** Resolves a logged set's exercise to the movement it was an instance of. */
export type ResolveEntry = (exerciseId: string) => CatalogEntry | undefined;

/**
 * exercise id → catalogue id, mirroring `getMuscleVolume()`: the link frozen
 * into a session snapshot wins over the live programme row, so an exercise
 * that was later repointed (or deleted) still counts toward what it was on
 * the day it was logged.
 */
export function catalogLinks(sessions: Session[], exercises: Exercise[]): Map<string, string> {
  const links = new Map<string, string>();
  for (const session of sessions) {
    for (const snapshot of session.exercises ?? []) {
      if (snapshot.catalogId && !links.has(snapshot.id)) links.set(snapshot.id, snapshot.catalogId);
    }
  }
  for (const exercise of exercises) {
    if (exercise.catalogId && !links.has(exercise.id)) links.set(exercise.id, exercise.catalogId);
  }
  return links;
}

/** Every catalogue id the links point at — what to `getCatalogEntriesByIds()`. */
export function linkedCatalogIds(links: Map<string, string>): string[] {
  return [...new Set(links.values())];
}

export function makeResolver(
  links: Map<string, string>,
  catalog: Map<string, CatalogEntry>,
): ResolveEntry {
  return (exerciseId) => {
    const catalogId = links.get(exerciseId);
    return catalogId ? catalog.get(catalogId) : undefined;
  };
}

/** Sets logged in one of `sessions` — i.e. dropping anything still in progress. */
export function setsInSessions(sets: SetLog[], sessions: Session[]): MuscleSet[] {
  const ids = new Set(sessions.map((s) => s.id));
  return sets.filter((set) => ids.has(set.sessionId));
}

/** When a session counts as having happened. */
export function sessionTime(session: Session): number {
  return session.finishedAt ?? session.startedAt;
}

/* --------------------------------------------------------------- week trend */

/** One week of the window: total weighted sets and how many sessions fed them. */
export interface WeekPoint {
  /** Local midnight on the Monday the week starts. */
  t: number;
  /** Short x-axis label, e.g. "3 Mar". */
  label: string;
  /** Weighted sets across every muscle (primary x1 + secondary x0.5). */
  value: number;
  /** Completed sessions that week — 0 means the week is not averaged over. */
  sessions: number;
}

/**
 * One point per week across the window, oldest first, empty weeks included as
 * zero. `sessionTimes` are the completed sessions, used only to tell an empty
 * week apart from a week with no training at all.
 */
export function buildWeekTrend(
  sets: MuscleSet[],
  sessionTimes: number[],
  resolve: ResolveEntry,
  weeks: number,
  now: number,
): WeekPoint[] {
  const buckets = bucketByWeek(sets, weeks, now);
  return buckets.map((bucket) => {
    const { rows } = tallyMuscles(bucket.sets, resolve);
    const value = rows.reduce((sum, row) => sum + row.weightedSets, 0);
    const sessions = sessionTimes.filter((t) => t >= bucket.start && t < bucket.end).length;
    return { t: bucket.start, label: formatDate(bucket.start, now), value, sessions };
  });
}

/**
 * Weeks in the window that actually trained something. Averaging over these
 * rather than over the window length keeps "sets per week" honest when the
 * window reaches back past the first session (or over a week off).
 */
export function activeWeeks(points: WeekPoint[]): number {
  return points.filter((point) => point.sessions > 0).length;
}

/* ----------------------------------------------------------------- per week */

/** One bar (and one table row) of the weekly-sets-per-muscle chart. */
export interface MuscleBarRow {
  muscle: Muscle;
  label: string;
  /** Weighted sets in the window ÷ the number of weeks that trained. */
  perWeek: number;
  /** Weighted sets over the whole window. */
  weightedSets: number;
  /** Distinct sessions that trained the muscle in the window. */
  sessions: number;
}

/**
 * The muscle rows averaged over `weeks`, biggest first. Ties keep the
 * canonical `MUSCLES` order because the tally emits them in it and `sort` is
 * stable. With no active week there is nothing to average — the caller shows
 * the empty state instead.
 */
export function perWeekRows(
  result: MuscleVolumeResult | undefined,
  weeks: number,
): MuscleBarRow[] {
  if (!result || weeks <= 0) return [];
  return result.rows
    .map((row) => ({
      muscle: row.muscle,
      label: MUSCLE_LABELS[row.muscle],
      perWeek: row.weightedSets / weeks,
      weightedSets: row.weightedSets,
      sessions: row.sessions,
    }))
    .sort((a, b) => b.perWeek - a.perWeek);
}

/** Split the bars into the ones worth charting and the ones to collapse away. */
export function splitByVolume(rows: MuscleBarRow[]): {
  trained: MuscleBarRow[];
  untouched: MuscleBarRow[];
} {
  return {
    trained: rows.filter((row) => row.perWeek > 0),
    untouched: rows.filter((row) => row.perWeek <= 0),
  };
}

/** "8.5" — one decimal everywhere, so the bar labels line up. */
export function formatPerWeek(value: number): string {
  return value.toFixed(1);
}

/* ------------------------------------------------------------------ labels */

/** "Glutes, hamstrings" — sentence case, so it reads as a phrase not a list of tags. */
function joinMuscles(muscles: readonly Muscle[]): string {
  return muscles
    .map((muscle, i) => (i === 0 ? MUSCLE_LABELS[muscle] : MUSCLE_LABELS[muscle].toLowerCase()))
    .join(', ');
}

/**
 * "Quads · Glutes, adductors" — what a catalogue entry trains, primaries then
 * secondaries. Empty when the entry names no muscles at all.
 */
export function describeMuscles(entry: Pick<CatalogEntry, 'primary' | 'secondary'>): string {
  const primary = joinMuscles(entry.primary ?? []);
  const secondary = joinMuscles(entry.secondary ?? []);
  return [primary, secondary].filter(Boolean).join(' · ');
}

/* ----------------------------------------------------------------- balance */

/** One ratio tile: the two sides normalised so the smaller one reads 1.0. */
export interface BalanceTile {
  id: 'pushPull' | 'squatHinge';
  title: string;
  /** e.g. "1.0 : 1.2". */
  ratio: string;
  /** Set when one side is more than 1.5x the other. */
  hint?: string;
  left: number;
  right: number;
}

const IMBALANCE = 1.5;

function tile(
  id: BalanceTile['id'],
  title: string,
  left: number,
  right: number,
  leftHint: string,
  rightHint: string,
): BalanceTile | undefined {
  if (left <= 0 && right <= 0) return undefined;
  const base = Math.min(left, right) || Math.max(left, right);
  const ratio = `${(left / base).toFixed(1)} : ${(right / base).toFixed(1)}`;
  const hint =
    right > left * IMBALANCE ? rightHint : left > right * IMBALANCE ? leftHint : undefined;
  return { id, title, ratio, left, right, ...(hint ? { hint } : {}) };
}

/**
 * The push:pull and squat:hinge tiles. A tile with nothing on either side is
 * dropped rather than shown as "0 : 0".
 */
export function balanceTiles(balance: PatternBalance | undefined): BalanceTile[] {
  if (!balance) return [];
  const tiles = [
    tile('pushPull', 'Push : Pull', balance.push, balance.pull, 'Push-heavy', 'Pull-heavy'),
    tile('squatHinge', 'Squat : Hinge', balance.squat, balance.hinge, 'Quad-heavy', 'Hinge-heavy'),
  ];
  return tiles.filter((t): t is BalanceTile => t !== undefined);
}
