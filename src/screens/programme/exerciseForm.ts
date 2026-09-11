/**
 * Pure helpers for the Programme edit sheet: the draft shape the form holds,
 * conversion to/from a stored `Exercise`, and validation. No DOM, no Dexie —
 * so this stays trivially testable.
 */
import type { Exercise, ExerciseType, LoadUnit, Measure, TemplateId } from '../../db/types';
import type { NewExercise } from '../../db/repo';
import { formatNumber } from '../../logic/format';

/** Form state. Numbers are nullable so a field can be temporarily empty. */
export interface ExerciseDraft {
  name: string;
  sets: number | null;
  /** True when the target is a rep *range* rather than a fixed number. */
  range: boolean;
  repMin: number | null;
  repMax: number | null;
  measure: Measure;
  perSide: boolean;
  unit: LoadUnit;
  increment: number | null;
  type: ExerciseType;
}

export const UNIT_OPTIONS: { value: LoadUnit; label: string }[] = [
  { value: 'kg_side', label: 'kg per hand' },
  { value: 'kg_total', label: 'kg total' },
  { value: 'band', label: 'Band' },
  { value: 'bodyweight', label: 'Bodyweight' },
  { value: 'none', label: 'None' },
];

export const MEASURE_OPTIONS: { value: Measure; label: string }[] = [
  { value: 'reps', label: 'Reps' },
  { value: 'seconds', label: 'Seconds' },
  { value: 'laps', label: 'Laps' },
];

export const TYPE_OPTIONS: { value: ExerciseType; label: string }[] = [
  { value: 'primary', label: 'Primary' },
  { value: 'accessory', label: 'Accessory' },
  { value: 'conditioning', label: 'Conditioning' },
];

/** Short unit tag for a list row: "kg/hand", "kg", "band", "BW", "—". */
export function unitLabel(unit: LoadUnit): string {
  switch (unit) {
    case 'kg_side':
      return 'kg/hand';
    case 'kg_total':
      return 'kg';
    case 'band':
      return 'band';
    case 'bodyweight':
      return 'BW';
    case 'none':
      return '—';
  }
}

/** Bands, bodyweight and conditioning have nothing to add plates to. */
export function incrementDisabled(unit: LoadUnit): boolean {
  return unit === 'band' || unit === 'bodyweight' || unit === 'none';
}

/** "+5 kg" / "—" for a list row. */
export function incrementLabel(exercise: Exercise): string {
  if (incrementDisabled(exercise.unit) || !exercise.increment) return '—';
  return `+${formatNumber(exercise.increment)} kg`;
}

/** Defaults for "Add exercise": 3 × 10 reps, kg total, +2.5, accessory. */
export function blankDraft(): ExerciseDraft {
  return {
    name: '',
    sets: 3,
    range: false,
    repMin: 10,
    repMax: 10,
    measure: 'reps',
    perSide: false,
    unit: 'kg_total',
    increment: 2.5,
    type: 'accessory',
  };
}

export function draftFromExercise(exercise: Exercise): ExerciseDraft {
  return {
    name: exercise.name,
    sets: exercise.sets,
    range: exercise.repMin !== exercise.repMax,
    repMin: exercise.repMin,
    repMax: exercise.repMax,
    measure: exercise.measure,
    perSide: exercise.perSide,
    unit: exercise.unit,
    increment: exercise.increment,
    type: exercise.type,
  };
}

export type DraftErrors = Partial<Record<'name' | 'sets' | 'reps' | 'increment', string>>;

function finite(n: number | null): n is number {
  return n !== null && Number.isFinite(n);
}

/** Field-keyed messages; an empty object means the draft is saveable. */
export function validateDraft(draft: ExerciseDraft): DraftErrors {
  const errors: DraftErrors = {};

  if (!draft.name.trim()) errors.name = 'Give it a name.';

  if (!finite(draft.sets) || draft.sets < 1) {
    errors.sets = 'At least 1 set.';
  }

  const min = draft.repMin;
  const max = draft.range ? draft.repMax : draft.repMin;
  if (!finite(min) || min < 0 || !finite(max) || max < 0) {
    errors.reps = 'Targets must be 0 or more.';
  } else if (draft.range && min > max) {
    errors.reps = 'Min must be at or below max.';
  }

  if (!incrementDisabled(draft.unit)) {
    if (!finite(draft.increment) || draft.increment < 0) {
      errors.increment = 'Increment must be 0 or more.';
    }
  }

  return errors;
}

/** Ready to hand to `upsertExercise`. Call only on a valid draft. */
export function draftToInput(
  draft: ExerciseDraft,
  templateId: TemplateId,
  id?: string,
): NewExercise {
  const repMin = draft.repMin ?? 0;
  const repMax = draft.range ? (draft.repMax ?? repMin) : repMin;
  return {
    ...(id ? { id } : {}),
    templateId,
    name: draft.name.trim(),
    sets: Math.round(draft.sets ?? 1),
    repMin,
    repMax,
    measure: draft.measure,
    perSide: draft.perSide,
    unit: draft.unit,
    increment: incrementDisabled(draft.unit) ? 0 : (draft.increment ?? 0),
    type: draft.type,
    archived: false,
  };
}
