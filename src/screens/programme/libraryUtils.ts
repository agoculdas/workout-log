/**
 * Pure helpers for the exercise Library: the strings a catalogue row shows,
 * the grouping that turns one programme read into per-entry "appears in"
 * hints, and the draft shape the add/edit sheet holds. No DOM, no Dexie.
 */
import {
  MUSCLES,
  SPLIT_TAGS,
  type CatalogEntry,
  type Equipment,
  type Exercise,
  type LoadUnit,
  type Measure,
  type Muscle,
  type Pattern,
  type SplitTag,
  type SplitTagGroup,
  type Template,
  type TemplateId,
} from '../../db/types';
import { EQUIPMENT_LABELS, MUSCLE_LABELS, PATTERN_LABELS } from '../../db/labels';
import type { NewCatalogEntry } from '../../db/repo';

const MUSCLE_ORDER = new Map<Muscle, number>(MUSCLES.map((m, i) => [m, i]));

/** Canonical display order (the order `MUSCLES` declares), duplicates dropped. */
export function sortMuscles(muscles: readonly Muscle[] | undefined): Muscle[] {
  return [...new Set(muscles ?? [])].sort(
    (a, b) => (MUSCLE_ORDER.get(a) ?? 99) - (MUSCLE_ORDER.get(b) ?? 99),
  );
}

/**
 * "Quads, glutes" — the first muscle keeps its label case, the rest are
 * lowercased so the list reads as one phrase rather than a row of headings.
 */
export function muscleList(muscles: readonly Muscle[] | undefined): string {
  return sortMuscles(muscles)
    .map((m, i) => (i === 0 ? MUSCLE_LABELS[m] : MUSCLE_LABELS[m].toLowerCase()))
    .join(', ');
}

/** The two halves of a row's muscle line, e.g. "Quads" · "Glutes, adductors". */
export function muscleSummary(entry: CatalogEntry): { primary: string; secondary: string } {
  return { primary: muscleList(entry.primary), secondary: muscleList(entry.secondary) };
}

/** "Machine · Squat · each side" — the small print under a catalogue row. */
export function entryMeta(entry: CatalogEntry): string {
  const parts = [EQUIPMENT_LABELS[entry.equipment], PATTERN_LABELS[entry.pattern]];
  if (entry.unilateral) parts.push('each side');
  return parts.join(' · ');
}

/** Group programme rows by the catalogue entry they came from. */
export function groupByCatalogId(exercises: readonly Exercise[]): Map<string, Exercise[]> {
  const map = new Map<string, Exercise[]>();
  for (const exercise of exercises) {
    if (!exercise.catalogId) continue;
    const list = map.get(exercise.catalogId);
    if (list) list.push(exercise);
    else map.set(exercise.catalogId, [exercise]);
  }
  return map;
}

/** Template id → name, for the "appears in" hints. */
export function templateNames(templates: readonly Template[]): Map<TemplateId, string> {
  return new Map(templates.map((t) => [t.id, t.name]));
}

/**
 * "in Lower A, Lower B" — each day named once, in template order. Empty when
 * the movement is not on any day.
 */
export function appearsInLabel(
  rows: readonly Exercise[] | undefined,
  names: Map<TemplateId, string>,
): string {
  if (!rows?.length) return '';
  const seen: string[] = [];
  for (const row of rows) {
    const name = names.get(row.templateId) ?? row.templateId;
    if (!seen.includes(name)) seen.push(name);
  }
  return `in ${seen.join(', ')}`;
}

/* ------------------------------------------------------------- filter chips */

export interface TagFilterGroup {
  key: SplitTagGroup;
  tags: SplitTag[];
}

/**
 * The split-tag filter row, grouped as `SPLIT_TAGS` declares but with each tag
 * appearing exactly once — `legs` is both a PPL and a body-part tag, and two
 * chips writing the same filter would highlight together.
 */
export const TAG_FILTER_GROUPS: TagFilterGroup[] = (() => {
  const seen = new Set<SplitTag>();
  const groups: TagFilterGroup[] = [];
  for (const [key, tags] of Object.entries(SPLIT_TAGS) as [
    SplitTagGroup,
    readonly SplitTag[],
  ][]) {
    const fresh = tags.filter((tag) => !seen.has(tag));
    fresh.forEach((tag) => seen.add(tag));
    if (fresh.length) groups.push({ key, tags: fresh });
  }
  return groups;
})();

/** Toggle behaviour for the single-choice filter chips: same value clears it. */
export function toggleFilter<T>(current: T | undefined, value: T): T | undefined {
  return current === value ? undefined : value;
}

/* ------------------------------------------------------------------- drafts */

/** Form state for the add/edit sheet. */
export interface CatalogDraft {
  name: string;
  primary: Muscle[];
  secondary: Muscle[];
  equipment: Equipment;
  pattern: Pattern;
  unilateral: boolean;
  tags: SplitTag[];
  defaultUnit: LoadUnit;
  defaultMeasure: Measure;
  notes: string;
}

export function blankCatalogDraft(): CatalogDraft {
  return {
    name: '',
    primary: [],
    secondary: [],
    equipment: 'machine',
    pattern: 'isolation',
    unilateral: false,
    tags: [],
    defaultUnit: 'kg_total',
    defaultMeasure: 'reps',
    notes: '',
  };
}

export function draftFromEntry(entry: CatalogEntry): CatalogDraft {
  return {
    name: entry.name,
    primary: sortMuscles(entry.primary),
    secondary: sortMuscles(entry.secondary),
    equipment: entry.equipment,
    pattern: entry.pattern,
    unilateral: entry.unilateral,
    tags: [...(entry.tags ?? [])],
    defaultUnit: entry.defaultUnit,
    defaultMeasure: entry.defaultMeasure,
    notes: entry.notes ?? '',
  };
}

/** Add when missing, remove when present. Order follows `MUSCLES` for muscles. */
export function toggleTag(tags: readonly SplitTag[], tag: SplitTag): SplitTag[] {
  return tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
}

/**
 * Toggle a muscle in one of the two lists. A muscle can only be primary *or*
 * secondary, so selecting it in one drops it from the other.
 */
export function toggleMuscle(
  draft: CatalogDraft,
  role: 'primary' | 'secondary',
  muscle: Muscle,
): Pick<CatalogDraft, 'primary' | 'secondary'> {
  const other = role === 'primary' ? 'secondary' : 'primary';
  const mine = draft[role];
  const next = mine.includes(muscle)
    ? mine.filter((m) => m !== muscle)
    : sortMuscles([...mine, muscle]);
  return {
    [role]: next,
    [other]: draft[other].filter((m) => m !== muscle),
  } as Pick<CatalogDraft, 'primary' | 'secondary'>;
}

export type CatalogDraftErrors = Partial<Record<'name' | 'muscles', string>>;

/**
 * Field-keyed messages; an empty object means the draft is saveable. Every
 * movement needs a primary mover, except conditioning — a 1 km row does not
 * train one muscle in particular.
 */
export function validateCatalogDraft(draft: CatalogDraft): CatalogDraftErrors {
  const errors: CatalogDraftErrors = {};
  if (!draft.name.trim()) errors.name = 'Give it a name.';
  if (!draft.primary.length && draft.pattern !== 'conditioning') {
    errors.muscles = 'Pick at least one primary muscle (or set the pattern to conditioning).';
  }
  return errors;
}

/** Ready to hand to `upsertCatalogEntry`. Call only on a valid draft. */
export function draftToCatalogInput(draft: CatalogDraft, id?: string): NewCatalogEntry {
  const notes = draft.notes.trim();
  return {
    ...(id ? { id } : {}),
    name: draft.name.trim(),
    primary: sortMuscles(draft.primary),
    secondary: sortMuscles(draft.secondary).filter((m) => !draft.primary.includes(m)),
    equipment: draft.equipment,
    pattern: draft.pattern,
    unilateral: draft.unilateral,
    tags: [...new Set(draft.tags)],
    defaultUnit: draft.defaultUnit,
    defaultMeasure: draft.defaultMeasure,
    ...(notes ? { notes } : {}),
  };
}

/* ------------------------------------------------------------ select options */

export const EQUIPMENT_OPTIONS: { value: Equipment; label: string }[] = (
  Object.keys(EQUIPMENT_LABELS) as Equipment[]
).map((value) => ({ value, label: EQUIPMENT_LABELS[value] }));

export const PATTERN_OPTIONS: { value: Pattern; label: string }[] = (
  Object.keys(PATTERN_LABELS) as Pattern[]
).map((value) => ({ value, label: PATTERN_LABELS[value] }));
