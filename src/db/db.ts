import Dexie, { type Table } from 'dexie';
import type {
  BodyweightEntry,
  CatalogEntry,
  Exercise,
  Session,
  SetLog,
  Settings,
  Template,
} from './types';
import {
  DEFAULT_SETTINGS,
  SEED_CATALOG,
  SEED_EXERCISES,
  SEED_EXERCISE_TO_CATALOG,
  SEED_TEMPLATES,
} from './seed';

export class WorkoutDB extends Dexie {
  templates!: Table<Template, string>;
  exercises!: Table<Exercise, string>;
  sessions!: Table<Session, string>;
  setLogs!: Table<SetLog, string>;
  settings!: Table<Settings, string>;
  bodyweight!: Table<BodyweightEntry, string>;
  catalog!: Table<CatalogEntry, string>;

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

    // v2 — the exercise catalogue. Exercises gain a `catalogId` index, and the
    // upgrade seeds the catalogue and links everything that already exists.
    this.version(2)
      .stores({
        exercises: 'id, templateId, catalogId, [templateId+order]',
        catalog: 'id, name, *tags, *primary, archived',
      })
      .upgrade(async (tx) => {
        await backfillCatalogLinks({
          catalog: tx.table('catalog'),
          exercises: tx.table('exercises'),
          sessions: tx.table('sessions'),
        });
      });

    this.on('populate', () => {
      void this.seed();
    });
  }

  /** Writes the fixed programme, the catalogue and default settings. */
  async seed(): Promise<void> {
    await this.templates.bulkPut(SEED_TEMPLATES);
    await this.exercises.bulkPut(SEED_EXERCISES);
    await this.catalog.bulkPut(SEED_CATALOG);
    await this.settings.put({ ...DEFAULT_SETTINGS });
  }
}

/** The three tables `backfillCatalogLinks` touches, as a live db or a tx. */
export interface CatalogBackfillTables {
  catalog: {
    count(): Promise<number>;
    toArray(): Promise<CatalogEntry[]>;
    bulkPut(rows: CatalogEntry[]): Promise<unknown>;
  };
  exercises: { toArray(): Promise<Exercise[]>; put(row: Exercise): Promise<unknown> };
  sessions: { toArray(): Promise<Session[]>; put(row: Session): Promise<unknown> };
}

/** What one backfill pass changed. All zeros on a second (no-op) run. */
export interface CatalogBackfillCounts {
  /** Catalogue rows inserted (only when the table was empty). */
  catalog: number;
  /** Programme exercises that gained a `catalogId`. */
  exercises: number;
  /** Session snapshot entries that gained a `catalogId`. */
  snapshots: number;
}

/**
 * Seeds the catalogue when it is empty, then links exercises and session
 * snapshots to it: by seed id first (`SEED_EXERCISE_TO_CATALOG`), then by a
 * case-insensitive name match. Rows that already carry a valid `catalogId` are
 * left alone, so running this twice is a no-op.
 */
export async function backfillCatalogLinks(
  tables: CatalogBackfillTables,
): Promise<CatalogBackfillCounts> {
  const counts: CatalogBackfillCounts = { catalog: 0, exercises: 0, snapshots: 0 };

  if ((await tables.catalog.count()) === 0) {
    await tables.catalog.bulkPut(SEED_CATALOG.map((entry) => ({ ...entry })));
    counts.catalog = SEED_CATALOG.length;
  }

  const catalog = await tables.catalog.toArray();
  if (!catalog.length) return counts;
  const knownIds = new Set(catalog.map((entry) => entry.id));
  const byName = new Map<string, string>();
  for (const entry of catalog) {
    const key = entry.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, entry.id);
  }

  const resolve = (exerciseId: string, name: string | undefined): string | undefined => {
    const seeded = SEED_EXERCISE_TO_CATALOG[exerciseId];
    if (seeded && knownIds.has(seeded)) return seeded;
    return name ? byName.get(name.trim().toLowerCase()) : undefined;
  };

  const linkByExerciseId = new Map<string, string>();
  for (const row of await tables.exercises.toArray()) {
    if (row.catalogId && knownIds.has(row.catalogId)) {
      linkByExerciseId.set(row.id, row.catalogId);
      continue;
    }
    const catalogId = resolve(row.id, row.name);
    if (!catalogId) continue;
    await tables.exercises.put({ ...row, catalogId });
    linkByExerciseId.set(row.id, catalogId);
    counts.exercises++;
  }

  for (const session of await tables.sessions.toArray()) {
    if (!Array.isArray(session.exercises) || !session.exercises.length) continue;
    let changed = false;
    const exercises = session.exercises.map((snapshot) => {
      if (snapshot.catalogId) return snapshot;
      const catalogId = linkByExerciseId.get(snapshot.id) ?? resolve(snapshot.id, snapshot.name);
      if (!catalogId) return snapshot;
      changed = true;
      counts.snapshots++;
      return { ...snapshot, catalogId };
    });
    if (changed) await tables.sessions.put({ ...session, exercises });
  }

  return counts;
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
    const [templateCount, exerciseCount, catalogCount, settings] = await Promise.all([
      database.templates.count(),
      database.exercises.count(),
      database.catalog.count(),
      database.settings.get('settings'),
    ]);
    if (templateCount === 0) await database.templates.bulkPut(SEED_TEMPLATES);
    if (exerciseCount === 0) await database.exercises.bulkPut(SEED_EXERCISES);
    if (catalogCount === 0) await database.catalog.bulkPut(SEED_CATALOG);
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
