/**
 * Pure shaping for the on-demand review in History → Muscles.
 *
 * The review reads the same per-week averages the chart draws — weighted sets
 * over the weeks that actually trained — and sorts them against the band in
 * Settings. Nothing here touches Dexie or React, and nothing here decides to
 * change anything: it states where the numbers fell and which library entries
 * would touch the muscles that came up short.
 */
import { MUSCLE_LABELS } from '../../db/labels';
import type { CatalogEntry, Muscle } from '../../db/types';

/** The weekly band from Settings: `setsPerMuscleTarget`. */
export interface SetsTarget {
  min: number;
  max: number;
}

/** One muscle as the review talks about it. A subset of `MuscleBarRow`. */
export interface ReviewRow {
  muscle: Muscle;
  label: string;
  /** Weighted sets per active week. */
  perWeek: number;
}

/** The three buckets, each already in the order the sheet lists them. */
export interface MuscleReview {
  /** Below `min`, least-trained first. */
  under: ReviewRow[];
  /** Above `max`, most-trained first. */
  over: ReviewRow[];
  /** Between the two, in the order they arrived. */
  inRange: ReviewRow[];
}

function toRow(row: ReviewRow): ReviewRow {
  return { muscle: row.muscle, label: row.label, perWeek: row.perWeek };
}

/**
 * Split every muscle against the band. The boundaries count as in range, so a
 * muscle sitting exactly on 10 or 20 is not called out either way.
 *
 * `rows` is expected to cover the whole body (the tally emits every muscle,
 * zeros included), so an untrained muscle lands in `under` at 0.0 rather than
 * vanishing.
 */
export function classifyMuscles(rows: readonly ReviewRow[], target: SetsTarget): MuscleReview {
  const under: ReviewRow[] = [];
  const over: ReviewRow[] = [];
  const inRange: ReviewRow[] = [];
  for (const row of rows) {
    if (row.perWeek < target.min) under.push(toRow(row));
    else if (row.perWeek > target.max) over.push(toRow(row));
    else inRange.push(toRow(row));
  }
  under.sort((a, b) => a.perWeek - b.perWeek);
  over.sort((a, b) => b.perWeek - a.perWeek);
  return { under, over, inRange };
}

/** The under list cut in two by whether the programme trains the muscle at all. */
export interface ProgrammeSplit {
  /** The muscle is a primary or secondary of something you already run. */
  inProgramme: ReviewRow[];
  /** Nothing in the active programme touches it. */
  notInProgramme: ReviewRow[];
}

/**
 * Under-target muscles grouped by whether the active programme trains them.
 * The distinction is the whole point of the list: a muscle your programme
 * covers is a volume question, one it does not cover is a gap.
 */
export function splitByProgramme(
  rows: readonly ReviewRow[],
  programmeMuscles: Iterable<Muscle>,
): ProgrammeSplit {
  const covered = new Set(programmeMuscles);
  return {
    inProgramme: rows.filter((row) => covered.has(row.muscle)),
    notInProgramme: rows.filter((row) => !covered.has(row.muscle)),
  };
}

/** Every muscle the given catalogue entries train, primary or secondary. */
export function muscleCoverage(entries: Iterable<Pick<CatalogEntry, 'primary' | 'secondary'>>) {
  const covered = new Set<Muscle>();
  for (const entry of entries) {
    for (const muscle of entry.primary ?? []) covered.add(muscle);
    for (const muscle of entry.secondary ?? []) covered.add(muscle);
  }
  return covered;
}

/**
 * Library entries worth offering for `muscle`: the ones that train it, primary
 * movers first, with anything already in the programme (`excludeIds`) and
 * anything archived dropped. Order within each half is the order given, which
 * from `listCatalog()` is by name.
 */
export function candidateEntries(
  entries: readonly CatalogEntry[],
  muscle: Muscle,
  excludeIds: Iterable<string>,
): CatalogEntry[] {
  const exclude = new Set(excludeIds);
  const primary: CatalogEntry[] = [];
  const secondary: CatalogEntry[] = [];
  for (const entry of entries) {
    if (entry.archived || exclude.has(entry.id)) continue;
    if (entry.primary?.includes(muscle)) primary.push(entry);
    else if (entry.secondary?.includes(muscle)) secondary.push(entry);
  }
  return [...primary, ...secondary];
}

/* ------------------------------------------------------------------ strings */

/** "10–20" — the band as the rows spell it. */
export function formatTarget(target: SetsTarget): string {
  return `${target.min}–${target.max}`;
}

/** "Rear delts · 2.5 sets/week (target 10–20)". */
export function formatReviewRow(row: ReviewRow, target: SetsTarget): string {
  return `${row.label} · ${row.perWeek.toFixed(1)} sets/week (target ${formatTarget(target)})`;
}

/** "12 muscles in range." — the whole of the third group. */
export function formatInRange(count: number): string {
  return `${count} muscle${count === 1 ? '' : 's'} in range.`;
}

/** "Averages over 3 active weeks. Warm-ups excluded. Secondary muscles count half." */
export function formatBasis(activeWeeks: number): string {
  return `Averages over ${activeWeeks} active week${activeWeeks === 1 ? '' : 's'}. Warm-ups excluded. Secondary muscles count half.`;
}

/** "Movements for rear delts" — the disclosure label. */
export function formatMovementsLabel(muscle: Muscle): string {
  return `Movements for ${MUSCLE_LABELS[muscle].toLowerCase()}`;
}

/** How many of the "not in your programme" muscles get a movement list. */
export const MOVEMENT_SUGGESTIONS = 3;
