/** One of the four fixed programme days. */
export type TemplateId = 'lowerA' | 'upperA' | 'lowerB' | 'upperB';

/** Progression family. `conditioning` items (e.g. Row 1 km) only log a time. */
export type ExerciseType = 'primary' | 'accessory' | 'conditioning';

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

export interface Template {
  id: TemplateId;
  name: string;
  kind: 'lower' | 'upper';
  /** Position in the rotation: 0..3, lowerA → upperA → lowerB → upperB. */
  order: number;
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
  templateId: TemplateId;
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
>;

export interface Session {
  id: string;
  templateId: TemplateId;
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
