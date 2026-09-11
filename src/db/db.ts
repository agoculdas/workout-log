import Dexie, { type Table } from 'dexie';
import type {
  BodyweightEntry,
  Exercise,
  Session,
  SetLog,
  Settings,
  Template,
} from './types';
import { DEFAULT_SETTINGS, SEED_EXERCISES, SEED_TEMPLATES } from './seed';

export class WorkoutDB extends Dexie {
  templates!: Table<Template, string>;
  exercises!: Table<Exercise, string>;
  sessions!: Table<Session, string>;
  setLogs!: Table<SetLog, string>;
  settings!: Table<Settings, string>;
  bodyweight!: Table<BodyweightEntry, string>;

  constructor(name = 'workout-log') {
    super(name);
    this.version(1).stores({
      templates: 'id, order',
      exercises: 'id, templateId, [templateId+order]',
      sessions: 'id, startedAt, finishedAt, templateId',
      setLogs: 'id, sessionId, exerciseId, [sessionId+exerciseId]',
      settings: 'id',
      bodyweight: 'id, date',
    });

    this.on('populate', () => {
      void this.seed();
    });
  }

  /** Writes the fixed programme + default settings. Safe to call on an empty db. */
  async seed(): Promise<void> {
    await this.templates.bulkPut(SEED_TEMPLATES);
    await this.exercises.bulkPut(SEED_EXERCISES);
    await this.settings.put({ ...DEFAULT_SETTINGS });
  }
}

export const db = new WorkoutDB();

let seedPromise: Promise<void> | null = null;

/**
 * Belt-and-braces seeding: `db.on('populate')` only fires when the database is
 * created, so call this once at app start in case the schema existed but the
 * rows never landed. Idempotent and safe to call concurrently.
 */
export function ensureSeeded(database: WorkoutDB = db): Promise<void> {
  if (database === db && seedPromise) return seedPromise;
  const run = (async () => {
    const [templateCount, exerciseCount, settings] = await Promise.all([
      database.templates.count(),
      database.exercises.count(),
      database.settings.get('settings'),
    ]);
    if (templateCount === 0) await database.templates.bulkPut(SEED_TEMPLATES);
    if (exerciseCount === 0) await database.exercises.bulkPut(SEED_EXERCISES);
    if (!settings) await database.settings.put({ ...DEFAULT_SETTINGS });
  })();
  if (database === db) seedPromise = run;
  return run;
}

/** Test hook: forget the memoised ensureSeeded() promise. */
export function resetSeedGuard(): void {
  seedPromise = null;
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
