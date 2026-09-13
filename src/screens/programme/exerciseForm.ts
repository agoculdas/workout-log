/**
 * Pure helpers for the Programme edit sheet: the draft shape the form holds,
 * conversion to/from a stored `Exercise`, and validation. No DOM, no Dexie —
 * so this stays trivially testable.
 */
import type {
  Exercise,
  ExerciseType,
  LoadUnit,
  MassUnit,
  Measure,
  TemplateId,
} from '../../db/types';
import type { NewExercise } from '../../db/repo';
import { formatMassUnit, formatNumber } from '../../logic/format';
import { defaultIncrement, exerciseMassUnit, massLabel } from '../../logic/units';

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
  /** The denomination the load and the increment are read in. */
  massUnit: MassUnit;
  increment: number | null;
  type: ExerciseType;
}

/**
 * The load unit says *what the number counts*, not what it is measured in —
 * the denomination is its own choice, so these labels no longer say "kg".
 */
export const UNIT_OPTIONS: { value: LoadUnit; label: string }[] = [
  { value: 'kg_side', label: 'Per hand' },
  { value: 'kg_total', label: 'Total' },
  { value: 'band', label: 'Band' },
  { value: 'bodyweight', label: 'Bodyweight' },
  { value: 'none', label: 'None' },
];

export const MASS_UNIT_OPTIONS: { value: MassUnit; label: string }[] = [
  { value: 'kg', label: 'kg' },
  { value: 'lb', label: 'lb' },
];

/** Denomination only means something for a unit that carries a weight. */
export function hasDenomination(unit: LoadUnit): boolean {
  return unit === 'kg_side' || unit === 'kg_total';
}

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

/**
 * Short unit tag for a list row, in the row's own denomination: "kg/hand",
 * "lb/hand", "kg", "lb", "band", "BW", "—".
 */
export function unitLabel(unit: LoadUnit, massUnit: MassUnit = 'kg'): string {
  return formatMassUnit({ unit, massUnit });
}

/** Bands, bodyweight and conditioning have nothing to add plates to. */
export function incrementDisabled(unit: LoadUnit): boolean {
  return unit === 'band' || unit === 'bodyweight' || unit === 'none';
}

/** "+5 lb" / "+2.5 kg" / "—" for a list row. */
export function incrementLabel(exercise: Exercise): string {
  if (incrementDisabled(exercise.unit) || !exercise.increment) return '—';
  return `+${formatNumber(exercise.increment)} ${massLabel(exerciseMassUnit(exercise))}`;
}

/**
 * Defaults for "Add exercise": 3 × 10 reps, total load, accessory, and the
 * denomination Settings names for new rows (with its increment).
 */
export function blankDraft(massUnit: MassUnit = 'kg'): ExerciseDraft {
  return {
    name: '',
    sets: 3,
    range: false,
    repMin: 10,
    repMax: 10,
    measure: 'reps',
    perSide: false,
    unit: 'kg_total',
    massUnit,
    increment: defaultIncrement('kg_total', massUnit),
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
    massUnit: exerciseMassUnit(exercise),
    increment: exercise.increment,
    type: exercise.type,
  };
}

/**
 * Switching denomination. The increment is a gym fact, not a conversion —
 * an lb machine steps in 5 lb, not in 5.51 lb — so an untouched increment is
 * replaced by the new denomination's default. Once the user has typed their
 * own step in this sheet it is theirs, and stands.
 */
export function changeMassUnit(
  draft: ExerciseDraft,
  massUnit: MassUnit,
  incrementEdited: boolean,
): Partial<ExerciseDraft> {
  if (massUnit === draft.massUnit) return {};
  if (incrementEdited || incrementDisabled(draft.unit)) return { massUnit };
  return { massUnit, increment: defaultIncrement(draft.unit, massUnit) };
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
    massUnit: draft.massUnit,
    increment: incrementDisabled(draft.unit) ? 0 : (draft.increment ?? 0),
    type: draft.type,
    archived: false,
  };
}
