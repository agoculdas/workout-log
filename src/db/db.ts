import Dexie, { type Table } from 'dexie';
import type {
  BodyweightEntry,
  CatalogEntry,
  Exercise,
  Programme,
  Session,
  SetLog,
  Settings,
  SplitTag,
  Template,
} from './types';
import {
  DEFAULT_SETTINGS,
  SEED_CATALOG,
  SEED_EXERCISES,
  SEED_EXERCISE_TO_CATALOG,
  SEED_PROGRAMME_ID,
  SEED_TEMPLATES,
  seedProgramme,
} from './seed';

export class WorkoutDB extends Dexie {
  templates!: Table<Template, string>;
  programmes!: Table<Programme, string>;
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

    // v3 — programmes. Days became user-defined rows with split tags instead
    // of a fixed `kind`, and the rotation moved into a `Programme` row.
    this.version(3)
      .stores({
        templates: 'id, programmeId, [programmeId+order]',
        programmes: 'id, active',
      })
      .upgrade(async (tx) => {
        await migrateToProgrammes({
          programmes: tx.table('programmes'),
          templates: tx.table('templates'),
          sessions: tx.table('sessions'),
        });
      });

    this.on('populate', () => {
      void this.seed();
    });
  }

  /** Writes the stock programme, its days, the catalogue and default settings. */
  async seed(): Promise<void> {
    await this.programmes.put(seedProgramme());
    await this.templates.bulkPut(SEED_TEMPLATES.map((t) => ({ ...t })));
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

/* ------------------------------------------------- v2 -> v3: programmes */

/** The three tables `migrateToProgrammes` touches, as a live db or a tx. */
export interface ProgrammeMigrationTables {
  programmes: {
    toArray(): Promise<Programme[]>;
    get(id: string): Promise<Programme | undefined>;
    put(row: Programme): Promise<unknown>;
  };
  templates: { toArray(): Promise<Template[]>; put(row: Template): Promise<unknown> };
  sessions: { toArray(): Promise<Session[]>; put(row: Session): Promise<unknown> };
}

/** What one migration pass changed. All zeros on a second (no-op) run. */
export interface ProgrammeMigrationCounts {
  /** 1 when the stock programme row had to be created, 0 when it was there. */
  programmes: number;
  /** Templates that gained a `programmeId` / had `kind` converted to `tags`. */
  templates: number;
  /** Sessions that gained a `templateName` or a `programmeId` snapshot. */
  sessions: number;
}

/** A v2 template row: `kind` instead of `tags`, no `programmeId`. */
interface LegacyTemplate extends Partial<Template> {
  id: string;
  name: string;
  order: number;
  kind?: 'lower' | 'upper';
}

/**
 * `kind: 'lower'` becomes the bare `lower` tag and `kind: 'upper'` the bare
 * `upper` one — the same tags the stock seed and the `upper_lower_4` preset
 * use, so a migrated Lower A still clashes with a migrated Lower B and still
 * reads "Lower" rather than "Legs" (see `dayKindLabel`). Shared with the
 * import path in `repo.ts`, which accepts v2 bundles carrying `kind`.
 */
export function tagsFromKind(kind: 'lower' | 'upper' | undefined): SplitTag[] {
  if (kind === 'lower') return ['lower'];
  if (kind === 'upper') return ['upper'];
  return [];
}

/**
 * Moves the fixed four-day rotation into data: creates the stock `Programme`
 * row, attaches every orphan template to it with tags derived from the old
 * `kind` field, and stamps `templateName` / `programmeId` onto existing
 * sessions so history survives later renames. Rows that already carry the new
 * fields are left alone, so running this twice is a no-op.
 */
export async function migrateToProgrammes(
  tables: ProgrammeMigrationTables,
  now = Date.now(),
): Promise<ProgrammeMigrationCounts> {
  const counts: ProgrammeMigrationCounts = { programmes: 0, templates: 0, sessions: 0 };

  const existing = await tables.programmes.toArray();
  if (!existing.some((p) => p.id === SEED_PROGRAMME_ID)) {
    const anotherIsActive = existing.some((p) => p.active && !p.archived);
    await tables.programmes.put({ ...seedProgramme(now), active: !anotherIsActive });
    counts.programmes = 1;
  }

  const templates = (await tables.templates.toArray()) as unknown as LegacyTemplate[];
  const migrated: Template[] = [];
  for (const row of templates) {
    const needsProgramme = !row.programmeId;
    const needsTags = !Array.isArray(row.tags);
    const hasKind = 'kind' in row;
    const next: Template = {
      id: row.id,
      programmeId: row.programmeId ?? SEED_PROGRAMME_ID,
      name: row.name,
      tags: needsTags ? tagsFromKind(row.kind) : (row.tags as SplitTag[]),
      order: row.order,
      ...(row.archived === undefined ? {} : { archived: row.archived }),
    };
    migrated.push(next);
    if (!needsProgramme && !needsTags && !hasKind) continue;
    // `kind` is simply not copied across, which is how it gets deleted.
    await tables.templates.put(next);
    counts.templates++;
  }

  const byId = new Map(migrated.map((t) => [t.id, t]));
  for (const session of await tables.sessions.toArray()) {
    const template = byId.get(session.templateId);
    const patch: Partial<Session> = {};
    if (session.templateName === undefined && template) patch.templateName = template.name;
    if (session.programmeId === undefined && template) patch.programmeId = template.programmeId;
    if (!Object.keys(patch).length) continue;
    // `slotIndex` is deliberately left undefined: old sessions resolve their
    // position from the first occurrence of their template in the rotation.
    await tables.sessions.put({ ...session, ...patch });
    counts.sessions++;
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
    const [programmeCount, templateCount, exerciseCount, catalogCount, settings] =
      await Promise.all([
        database.programmes.count(),
        database.templates.count(),
        database.exercises.count(),
        database.catalog.count(),
        database.settings.get('settings'),
      ]);
    if (programmeCount === 0) await database.programmes.put(seedProgramme());
    if (templateCount === 0) {
      await database.templates.bulkPut(SEED_TEMPLATES.map((t) => ({ ...t })));
    }
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
