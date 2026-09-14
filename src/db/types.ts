/**
 * A programme day's id. Free-form since days became user-defined (Dexie v3);
 * the seeded upper/lower days keep their original slugs so exports from older
 * versions still merge cleanly.
 */
export type TemplateId = string;

/** Progression family. `conditioning` items (e.g. Row 1 km) only log a time. */
export type ExerciseType = 'primary' | 'accessory' | 'conditioning';

/**
 * How an exercise's load is advanced between sessions.
 *
 * - `double`    — add the increment once *every* set hits the top of the range.
 * - `linear`    — add it once every set clears the *bottom* of the range.
 * - `none`      — never suggest a change; repeat the last load and track reps.
 * - `best-time` — conditioning: pre-fill the best time so far, to beat.
 *
 * Absent on a row means `double` for primary/accessory and `best-time` for
 * conditioning — see `exerciseScheme` in `logic/progression`.
 */
export type ProgressionScheme = 'double' | 'linear' | 'none' | 'best-time';

/**
 * A one-off answer to a stall, chosen by hand from the stalled marker. It
 * replaces the next session's suggestion and nothing else: `finishSession`
 * clears it from every exercise that logged a working set, so it can never
 * quietly become the new normal. Deloads are never automatic.
 */
export interface ExerciseOverride {
  /** The load to pre-fill, in the exercise's own denomination. */
  load: number;
  /** The reps / seconds / laps target to pre-fill. */
  reps: number;
  /** Which button set it: 10% off, or back to the bottom of the range. */
  kind: 'deload' | 'bottom';
  /** Epoch ms it was chosen. */
  setAt: number;
}

/**
 * How the `load` number on a SetLog should be read.
 * - `kg_side`      — kg per hand / per side (dumbbells, farmer's walk)
 * - `kg_total`     — kg as shown on the machine / total on the bar
 * - `band`         — band resistance, load is a free number (or 0), no increment
 * - `bodyweight`   — no external load
 * - `none`         — nothing to load at all (conditioning)
 */
export type LoadUnit = 'kg_side' | 'kg_total' | 'band' | 'bodyweight' | 'none';

/**
 * The denomination a load is entered and shown in. Orthogonal to `LoadUnit`,
 * which only says whether the number is per side or total: a dumbbell rack
 * marked in pounds is `unit: 'kg_side'`, `massUnit: 'lb'`.
 */
export type MassUnit = 'kg' | 'lb';

/** One pound in kilograms (exact, by definition). */
export const KG_PER_LB = 0.45359237;

/** What the `reps` number on a SetLog counts. */
export type Measure = 'reps' | 'seconds' | 'laps';

/**
 * One programme day. `tags` replaced the old `lower` / `upper` `kind` field in
 * v3: lower/upper is derived from them (`isLowerDay` / `isUpperDay` in
 * `logic/days`), and they are what the clash rule compares.
 */
export interface Template {
  id: string;
  /** The programme this day belongs to. */
  programmeId: string;
  name: string;
  tags: SplitTag[];
  /** Position within its programme's day list. */
  order: number;
  /** Soft delete: off the rotation and the pickers, history still resolves it. */
  archived?: boolean;
}

/** One position in a programme's rotation: a training day, or a rest day. */
export type RotationSlot = { templateId: string } | { rest: true };

/**
 * A saved split. Several can exist; exactly one is `active` and drives Today,
 * the day pickers and the library's "appears in" hints.
 */
export interface Programme {
  id: string;
  name: string;
  /** The week (or cycle) shape, walked in order and wrapped around. */
  rotation: RotationSlot[];
  active: boolean;
  createdAt: number;
  /** Soft delete: hidden from the lists, sessions keep their snapshots. */
  archived?: boolean;
}

/** Muscles a catalogue entry can train. Order is the canonical display order. */
export const MUSCLES = [
  'quads',
  'hamstrings',
  'glutes',
  'adductors',
  'abductors',
  'calves',
  'chest',
  'lats',
  'upper_back',
  'front_delts',
  'side_delts',
  'rear_delts',
  'biceps',
  'triceps',
  'forearms',
  'core',
  'lower_back',
] as const;
export type Muscle = (typeof MUSCLES)[number];

/** What the movement is loaded with. */
export const EQUIPMENT = [
  'barbell',
  'dumbbell',
  'machine',
  'cable',
  'band',
  'bodyweight',
  'kettlebell',
  'other',
] as const;
export type Equipment = (typeof EQUIPMENT)[number];

/** Movement pattern, used for push/pull/squat/hinge balance. */
export const PATTERNS = [
  'squat',
  'hinge',
  'lunge',
  'horizontal_push',
  'vertical_push',
  'horizontal_pull',
  'vertical_pull',
  'carry',
  'isolation',
  'core',
  'conditioning',
] as const;
export type Pattern = (typeof PATTERNS)[number];

/** Split tags: fixed vocabulary, grouped by split system for UI. */
export const SPLIT_TAGS = {
  upperLower: ['upper', 'lower'],
  ppl: ['push', 'pull', 'legs'],
  bodyPart: ['chest', 'back', 'shoulders', 'arms', 'legs', 'core'],
  other: ['cardio'],
} as const;

export type SplitTagGroup = keyof typeof SPLIT_TAGS;

export type SplitTag =
  | 'upper'
  | 'lower'
  | 'push'
  | 'pull'
  | 'legs'
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'arms'
  | 'core'
  | 'cardio';

/**
 * A movement in the exercise catalogue — the library you pick from when
 * building a day. Programme rows (`Exercise`) point at one via `catalogId`;
 * the catalogue carries what the movement *is* (muscles, equipment, pattern),
 * the programme row carries how *you* are running it (sets, reps, increment).
 */
export interface CatalogEntry {
  id: string;
  name: string;
  /** Muscles the movement trains directly. Counts 1 set each. */
  primary: Muscle[];
  /** Assisting muscles. Count 0.5 set each. */
  secondary: Muscle[];
  equipment: Equipment;
  pattern: Pattern;
  /** One limb at a time (the programme row's `perSide` defaults from this). */
  unilateral: boolean;
  tags: SplitTag[];
  defaultUnit: LoadUnit;
  defaultMeasure: Measure;
  notes?: string;
  /** Soft delete: hidden from pickers, still resolves for old exercises. */
  archived?: boolean;
}

export interface Exercise {
  id: string;
  templateId: string;
  name: string;
  /** The catalogue movement this row is an instance of, when it has one. */
  catalogId?: string;
  /** Position within the template's exercise list. */
  order: number;
  sets: number;
  /** repMin === repMax means a fixed target rather than a range. */
  repMin: number;
  repMax: number;
  measure: Measure;
  /** "each" / per-side item — display only, does not change the maths. */
  perSide: boolean;
  unit: LoadUnit;
  /**
   * The denomination this exercise's load is entered and shown in. Absent
   * means 'kg'. Only meaningful for `kg_side` / `kg_total` units.
   */
  massUnit?: MassUnit;
  /**
   * Progression step, in this exercise's `massUnit`. 0 for band / bodyweight /
   * none.
   */
  increment: number;
  type: ExerciseType;
  /** How the load advances. Absent means the default for `type`. */
  scheme?: ProgressionScheme;
  /**
   * A hand-picked answer to a stall that replaces the next suggestion once.
   * Never set automatically; cleared the moment the exercise is logged again.
   */
  override?: ExerciseOverride;
  /** Rest timer for this exercise in seconds. Absent means the Settings default. */
  restOverride?: number;
  /** A setup reminder, e.g. "Seat 4, handles narrow". Shown in Session. */
  note?: string;
  /** Soft delete, so old sessions can still resolve the name. */
  archived?: boolean;
}

/**
 * The exercise as it was prescribed when the session started. Frozen into the
 * session so later Programme edits (rename, reorder, change the rep range)
 * never rewrite what a finished session says — or shuffle one in progress.
 */
export type ExerciseSnapshot = Pick<
  Exercise,
  | 'id'
  | 'name'
  | 'sets'
  | 'repMin'
  | 'repMax'
  | 'measure'
  | 'perSide'
  | 'unit'
  | 'massUnit'
  | 'type'
  | 'catalogId'
  | 'scheme'
  | 'restOverride'
  | 'note'
> & {
  /**
   * Dropped from *this* session. The programme is untouched: the row stays in
   * the snapshot so history can say it was skipped, and unskipping is one tap.
   */
  skipped?: boolean;
  /**
   * Swapped in for this session only. Its `id` is a fresh `tmp_…` that no
   * `Exercise` row carries, so its sets resolve through this snapshot alone.
   */
  addedForToday?: boolean;
};

/** Prefix of an exercise id that only ever exists inside a session snapshot. */
export const TEMP_EXERCISE_PREFIX = 'tmp_';

/** True for a swapped-in-for-today exercise id — nothing in `exercises` has one. */
export function isTempExerciseId(id: string): boolean {
  return id.startsWith(TEMP_EXERCISE_PREFIX);
}

export interface Session {
  id: string;
  templateId: string;
  /** The day's name as of `startedAt`, so history survives renames/deletes. */
  templateName?: string;
  /** The programme the day belonged to when the session started. */
  programmeId?: string;
  /** The rotation slot this session was started from, when it came from one. */
  slotIndex?: number;
  startedAt: number;
  finishedAt?: number;
  notes?: string;
  /**
   * The template's exercises, in order, as of `startedAt`. Absent on sessions
   * recorded before snapshots existed — those fall back to the live rows.
   */
  exercises?: ExerciseSnapshot[];
}

export interface SetLog {
  id: string;
  sessionId: string;
  exerciseId: string;
  /** 0-based index of the set within the exercise for this session. */
  setIndex: number;
  /** In the exercise's `unit` and `massUnit`. 0 for bodyweight / none. */
  load: number;
  /** Reps, seconds or laps depending on `exercise.measure`. */
  reps: number;
  completedAt: number;
  /**
   * Absent (the default) means a working set. Warm-ups are excluded from
   * progression, volume, top sets and muscle tallies everywhere.
   */
  kind?: 'warmup';
  /**
   * A fact the user marked on the set. Never read by progression — set facts
   * do not drive suggestions.
   */
  toFailure?: boolean;
  /** Stamped from the exercise when the set was logged. Absent means 'kg'. */
  massUnit?: MassUnit;
  /**
   * How the `load` number should be read, stamped from the exercise when the
   * set was logged. Absent on rows written before this existed — read it from
   * the exercise (or the session snapshot) at compute time instead.
   */
  unit?: LoadUnit;
}

export interface Settings {
  id: 'settings';
  /** Rest timer default in seconds for primary lifts. */
  restPrimary: number;
  /** Rest timer default in seconds for accessories. */
  restAccessory: number;
  /** Default denomination for exercises created from now on. */
  units: MassUnit;
  /** Hold a screen wake lock while the Session screen is open. */
  keepAwake: boolean;
  /** Epoch ms of the last successful export. Absent means never exported. */
  lastExportAt?: number;
  /** Barbell weight in kg, for the plate calculator. */
  barWeight: number;
  /** Plates available per side, in kg, for the plate calculator. */
  plates: number[];
  /** Weekly hard-set band per muscle, shown as a reference on the report. */
  setsPerMuscleTarget: { min: number; max: number };
  /**
   * Count your bodyweight x reps towards volume on `bodyweight` exercises,
   * using the latest weigh-in at or before the session. Off by default: it
   * changes what every past session's total says, so it is an opt-in.
   */
  countBodyweight?: boolean;
}

export interface BodyweightEntry {
  id: string;
  /** YYYY-MM-DD (local date). */
  date: string;
  kg: number;
}

/** Shape produced by `exportAll()` and accepted by `importMerge()`. */
export interface ExportBundle {
  version: 1;
  exportedAt: number;
  templates: Template[];
  /** Absent in bundles exported before programmes existed (v2 and earlier). */
  programmes?: Programme[];
  exercises: Exercise[];
  sessions: Session[];
  setLogs: SetLog[];
  settings: Settings[];
  bodyweight: BodyweightEntry[];
  /** Absent in bundles exported before the catalogue existed. */
  catalog?: CatalogEntry[];
}

/** Rows inserted per table by `importMerge()`. */
export interface ImportCounts {
  templates: number;
  programmes: number;
  exercises: number;
  sessions: number;
  setLogs: number;
  settings: number;
  bodyweight: number;
  catalog: number;
  skipped: number;
}

/** One muscle's share of the logged sets in a window. */
export interface MuscleVolumeRow {
  muscle: Muscle;
  /** Sets where this muscle was a *primary* mover. */
  sets: number;
  /** Primary sets x1 + secondary sets x0.5. */
  weightedSets: number;
  /** Distinct sessions that trained it (primary or secondary). */
  sessions: number;
}

/** `getMuscleVolume()` result: one row per muscle, plus what could not be resolved. */
export interface MuscleVolumeResult {
  rows: MuscleVolumeRow[];
  /** Logged sets whose exercise has no catalogue link, so they count nowhere. */
  unlinkedSets: number;
}

/** Logged sets grouped into the four balance buckets. */
export interface PatternBalance {
  push: number;
  pull: number;
  squat: number;
  hinge: number;
}

/** One session's worth of sets for a single exercise, used by history/progression. */
export interface ExerciseSessionHistory {
  session: Session;
  sets: SetLog[];
}
