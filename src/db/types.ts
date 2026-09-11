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

/** What the `reps` number on a SetLog counts. */
export type Measure = 'reps' | 'seconds' | 'laps';

export interface Template {
  id: TemplateId;
  name: string;
  kind: 'lower' | 'upper';
  /** Position in the rotation: 0..3, lowerA → upperA → lowerB → upperB. */
  order: number;
}

export interface Exercise {
  id: string;
  templateId: TemplateId;
  name: string;
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
  /** Progression step in kg. 0 for band / bodyweight / none. */
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
  'id' | 'name' | 'sets' | 'repMin' | 'repMax' | 'measure' | 'perSide' | 'unit' | 'type'
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
  /** In the exercise's `unit`. 0 for bodyweight / none. */
  load: number;
  /** Reps, seconds or laps depending on `exercise.measure`. */
  reps: number;
  completedAt: number;
}

export interface Settings {
  id: 'settings';
  /** Rest timer default in seconds for primary lifts. */
  restPrimary: number;
  /** Rest timer default in seconds for accessories. */
  restAccessory: number;
  units: 'kg';
  /** Hold a screen wake lock while the Session screen is open. */
  keepAwake: boolean;
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
}

/** Rows inserted per table by `importMerge()`. */
export interface ImportCounts {
  templates: number;
  exercises: number;
  sessions: number;
  setLogs: number;
  settings: number;
  bodyweight: number;
  skipped: number;
}

/** One session's worth of sets for a single exercise, used by history/progression. */
export interface ExerciseSessionHistory {
  session: Session;
  sets: SetLog[];
}
