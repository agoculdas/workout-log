/**
 * All database access for the UI goes through these plain async functions.
 * Screens can call them directly, or wrap them in `useLiveQuery` from
 * dexie-react-hooks to get reactive reads:
 *
 *   const exercises = useLiveQuery(() => listExercises('lowerA'), ['lowerA']);
 */
import { db, newId, type WorkoutDB } from './db';
import { DEFAULT_SETTINGS, SEED_EXERCISES, SEED_TEMPLATES } from './seed';
import type {
  BodyweightEntry,
  Exercise,
  ExerciseSessionHistory,
  ExerciseSnapshot,
  ExportBundle,
  ImportCounts,
  Session,
  SetLog,
  Settings,
  TemplateId,
  Template,
} from './types';

/* ------------------------------------------------------------------ settings */

/**
 * Fills in fields a row written by an older version of the app never had, so
 * adding a setting never needs a schema bump or a migration.
 */
function withDefaults(row: Settings): Settings {
  return { ...DEFAULT_SETTINGS, ...row, id: 'settings' };
}

export async function getSettings(): Promise<Settings> {
  const found = await db.settings.get('settings');
  if (found) return withDefaults(found);
  const fresh = { ...DEFAULT_SETTINGS };
  await db.settings.put(fresh);
  return fresh;
}

/**
 * Plain read, no write-on-miss — safe to call inside `useLiveQuery`, where a
 * write would retrigger the query it lives in.
 */
export async function readSettings(): Promise<Settings | undefined> {
  const found = await db.settings.get('settings');
  return found ? withDefaults(found) : undefined;
}

export async function updateSettings(
  patch: Partial<Omit<Settings, 'id'>>,
): Promise<Settings> {
  const current = await getSettings();
  const next: Settings = { ...current, ...patch, id: 'settings' };
  await db.settings.put(next);
  return next;
}

/* ----------------------------------------------------------------- templates */

/** The four programme days, in rotation order. */
export async function listTemplates(): Promise<Template[]> {
  const rows = await db.templates.toArray();
  return rows.sort((a, b) => a.order - b.order);
}

export async function getTemplate(id: TemplateId): Promise<Template | undefined> {
  return db.templates.get(id);
}

/* ----------------------------------------------------------------- exercises */

/**
 * Exercises for one template (or all templates when `templateId` is omitted),
 * sorted by `order`. Archived rows are excluded unless `includeArchived`.
 */
export async function listExercises(
  templateId?: TemplateId,
  includeArchived = false,
): Promise<Exercise[]> {
  const rows = templateId
    ? await db.exercises.where('templateId').equals(templateId).toArray()
    : await db.exercises.toArray();
  const visible = includeArchived ? rows : rows.filter((e) => !e.archived);
  return visible.sort((a, b) =>
    a.templateId === b.templateId
      ? a.order - b.order
      : a.templateId.localeCompare(b.templateId),
  );
}

export async function getExercise(id: string): Promise<Exercise | undefined> {
  return db.exercises.get(id);
}

/** Look up many exercises at once (history screens resolve names this way). */
export async function getExercisesByIds(ids: string[]): Promise<Map<string, Exercise>> {
  const rows = await db.exercises.bulkGet(ids);
  const map = new Map<string, Exercise>();
  rows.forEach((row) => {
    if (row) map.set(row.id, row);
  });
  return map;
}

export type NewExercise = Omit<Exercise, 'id' | 'order'> &
  Partial<Pick<Exercise, 'id' | 'order'>>;

/**
 * Create or update an exercise. Omit `id` to create one (a UUID is assigned);
 * omit `order` on create and it is appended to the end of its template.
 * Returns the stored row.
 */
export async function upsertExercise(input: NewExercise): Promise<Exercise> {
  const id = input.id ?? newId();
  const existing = input.id ? await db.exercises.get(input.id) : undefined;
  let order = input.order ?? existing?.order;
  if (order === undefined) {
    const siblings = await db.exercises
      .where('templateId')
      .equals(input.templateId)
      .toArray();
    order = siblings.reduce((max, e) => Math.max(max, e.order + 1), 0);
  }
  const row: Exercise = {
    archived: false,
    ...existing,
    ...input,
    id,
    order,
  };
  await db.exercises.put(row);
  return row;
}

/**
 * Rewrite `order` for a template from the given id sequence. Ids not in the
 * list keep their relative order and are appended after.
 */
export async function reorderExercises(
  templateId: TemplateId,
  orderedIds: string[],
): Promise<void> {
  await db.transaction('rw', db.exercises, async () => {
    const rows = await db.exercises.where('templateId').equals(templateId).toArray();
    const byId = new Map(rows.map((r) => [r.id, r]));
    let order = 0;
    for (const id of orderedIds) {
      const row = byId.get(id);
      if (!row) continue;
      await db.exercises.update(id, { order: order++ });
      byId.delete(id);
    }
    const rest = [...byId.values()].sort((a, b) => a.order - b.order);
    for (const row of rest) {
      await db.exercises.update(row.id, { order: order++ });
    }
  });
}

/** Soft delete: history keeps resolving the name, future sessions skip it. */
export async function archiveExercise(id: string, archived = true): Promise<void> {
  await db.exercises.update(id, { archived });
}

/* ------------------------------------------------------------------ sessions */

/** The nine prescription fields a session freezes for each of its exercises. */
export function exerciseSnapshot(exercise: Exercise): ExerciseSnapshot {
  return {
    id: exercise.id,
    name: exercise.name,
    sets: exercise.sets,
    repMin: exercise.repMin,
    repMax: exercise.repMax,
    measure: exercise.measure,
    perSide: exercise.perSide,
    unit: exercise.unit,
    type: exercise.type,
  };
}

/**
 * Starts (and persists) a new session. Partial sessions are saved as you go.
 * The template's current exercises are snapshotted into the row, so editing
 * the Programme mid-session cannot reorder or rename what you are logging.
 */
export async function startSession(
  templateId: TemplateId,
  startedAt = Date.now(),
): Promise<Session> {
  const exercises = (await listExercises(templateId)).map(exerciseSnapshot);
  const session: Session = { id: newId(), templateId, startedAt, exercises };
  await db.sessions.add(session);
  return session;
}

export async function finishSession(id: string, notes?: string): Promise<void> {
  const patch: Partial<Session> = { finishedAt: Date.now() };
  if (notes !== undefined) patch.notes = notes;
  await db.sessions.update(id, patch);
}

export async function updateSession(
  id: string,
  patch: Partial<Omit<Session, 'id'>>,
): Promise<void> {
  await db.sessions.update(id, patch);
}

/** Newest session that was started but never finished, if any. */
export async function getActiveSession(): Promise<Session | undefined> {
  const rows = await db.sessions.orderBy('startedAt').reverse().toArray();
  return rows.find((s) => s.finishedAt === undefined);
}

export async function getSession(id: string): Promise<Session | undefined> {
  return db.sessions.get(id);
}

/** All sessions, newest first. */
export async function listSessions(includeUnfinished = true): Promise<Session[]> {
  const rows = await db.sessions.orderBy('startedAt').reverse().toArray();
  return includeUnfinished ? rows : rows.filter((s) => s.finishedAt !== undefined);
}

/** Most recent finished session, or undefined. Feeds `pickNextSession`. */
export async function getLastCompletedSession(): Promise<Session | undefined> {
  const rows = await db.sessions.orderBy('startedAt').reverse().toArray();
  return rows.find((s) => s.finishedAt !== undefined);
}

/** Deletes a session and all of its sets. */
export async function deleteSession(id: string): Promise<void> {
  await db.transaction('rw', db.sessions, db.setLogs, async () => {
    await db.setLogs.where('sessionId').equals(id).delete();
    await db.sessions.delete(id);
  });
}

export interface SessionDetail {
  session: Session;
  template: Template | undefined;
  /**
   * The session's exercises in order: its snapshot when it has one, otherwise
   * the template's live rows — plus any extra exercise that has sets logged.
   */
  exercises: Exercise[];
  /** exerciseId -> that session's sets, sorted by setIndex. */
  setsByExercise: Record<string, SetLog[]>;
  /** Every set in the session, sorted by setIndex then time. */
  sets: SetLog[];
}

/**
 * A snapshot rendered as a full `Exercise`: the frozen prescription wins, the
 * live row supplies what a snapshot does not carry (increment, order) so the
 * screens keep working with one shape.
 */
function fromSnapshot(
  snapshot: ExerciseSnapshot,
  live: Exercise | undefined,
  templateId: TemplateId,
  order: number,
): Exercise {
  return {
    templateId: live?.templateId ?? templateId,
    order: live?.order ?? order,
    increment: live?.increment ?? 0,
    archived: live?.archived,
    ...snapshot,
  };
}

export async function getSessionDetail(id: string): Promise<SessionDetail | undefined> {
  const session = await db.sessions.get(id);
  if (!session) return undefined;
  const [template, templateExercises, sets] = await Promise.all([
    db.templates.get(session.templateId),
    listExercises(session.templateId),
    db.setLogs.where('sessionId').equals(id).toArray(),
  ]);
  sets.sort((a, b) => a.setIndex - b.setIndex || a.completedAt - b.completedAt);

  const snapshot = session.exercises;
  let exercises: Exercise[];
  if (snapshot?.length) {
    const liveRows = await db.exercises.bulkGet(snapshot.map((s) => s.id));
    const liveById = new Map<string, Exercise>();
    liveRows.forEach((row) => {
      if (row) liveById.set(row.id, row);
    });
    exercises = snapshot.map((snap, i) =>
      fromSnapshot(snap, liveById.get(snap.id), session.templateId, i),
    );
  } else {
    exercises = [...templateExercises];
  }

  const known = new Set(exercises.map((e) => e.id));
  const extraIds = [...new Set(sets.map((s) => s.exerciseId))].filter((x) => !known.has(x));
  if (extraIds.length) {
    const extras = await db.exercises.bulkGet(extraIds);
    extras.forEach((e) => {
      if (e) exercises.push(e);
    });
  }

  const setsByExercise: Record<string, SetLog[]> = {};
  for (const set of sets) {
    (setsByExercise[set.exerciseId] ??= []).push(set);
  }
  return { session, template, exercises, setsByExercise, sets };
}

/* ---------------------------------------------------------------------- sets */

export interface LogSetInput {
  sessionId: string;
  exerciseId: string;
  setIndex: number;
  load: number;
  reps: number;
  completedAt?: number;
}

/**
 * Record one completed set. Upserts on (sessionId, exerciseId, setIndex), so
 * re-tapping "done" on the same set corrects it instead of duplicating it.
 */
export async function logSet(input: LogSetInput): Promise<SetLog> {
  return db.transaction('rw', db.setLogs, async () => {
    const existing = await db.setLogs
      .where('[sessionId+exerciseId]')
      .equals([input.sessionId, input.exerciseId])
      .toArray();
    const match = existing.find((s) => s.setIndex === input.setIndex);
    const row: SetLog = {
      id: match?.id ?? newId(),
      sessionId: input.sessionId,
      exerciseId: input.exerciseId,
      setIndex: input.setIndex,
      load: input.load,
      reps: input.reps,
      completedAt: input.completedAt ?? Date.now(),
    };
    await db.setLogs.put(row);
    return row;
  });
}

export async function updateSet(
  id: string,
  patch: Partial<Omit<SetLog, 'id' | 'sessionId' | 'exerciseId'>>,
): Promise<void> {
  await db.setLogs.update(id, patch);
}

export async function deleteSet(id: string): Promise<void> {
  await db.setLogs.delete(id);
}

/**
 * Every set in the database, unsorted. The History list groups them by session
 * itself; this exists so screens never have to reach for Dexie directly.
 */
export async function listAllSetLogs(): Promise<SetLog[]> {
  return db.setLogs.toArray();
}

/** Sets logged for one exercise inside one session, sorted by setIndex. */
export async function listSetsForSessionExercise(
  sessionId: string,
  exerciseId: string,
): Promise<SetLog[]> {
  const rows = await db.setLogs
    .where('[sessionId+exerciseId]')
    .equals([sessionId, exerciseId])
    .toArray();
  return rows.sort((a, b) => a.setIndex - b.setIndex);
}

/**
 * Sets for this exercise from the most recent session that logged it, sorted
 * by setIndex. Pass the current session id as `beforeSessionId` so the session
 * you are in is not treated as its own history. Feeds `suggestLoad`.
 */
export async function getLastSessionSetsForExercise(
  exerciseId: string,
  beforeSessionId?: string,
): Promise<SetLog[] | undefined> {
  const history = await getExerciseHistory(exerciseId);
  const usable = beforeSessionId
    ? history.filter((h) => h.session.id !== beforeSessionId)
    : history;
  const last = usable[usable.length - 1];
  return last ? last.sets : undefined;
}

/** Per-session sets for one exercise, oldest to newest. Empty sessions omitted. */
export async function getExerciseHistory(
  exerciseId: string,
): Promise<ExerciseSessionHistory[]> {
  const sets = await db.setLogs.where('exerciseId').equals(exerciseId).toArray();
  if (!sets.length) return [];
  const bySession = new Map<string, SetLog[]>();
  for (const set of sets) {
    const list = bySession.get(set.sessionId);
    if (list) list.push(set);
    else bySession.set(set.sessionId, [set]);
  }
  const sessions = await db.sessions.bulkGet([...bySession.keys()]);
  const out: ExerciseSessionHistory[] = [];
  sessions.forEach((session) => {
    if (!session) return;
    const list = bySession.get(session.id) ?? [];
    list.sort((a, b) => a.setIndex - b.setIndex);
    out.push({ session, sets: list });
  });
  return out.sort((a, b) => a.session.startedAt - b.session.startedAt);
}

/* --------------------------------------------------------------- bodyweight */

/** Adds (or replaces) the entry for `date` (YYYY-MM-DD). One entry per day. */
export async function addBodyweight(date: string, kg: number): Promise<BodyweightEntry> {
  const existing = await db.bodyweight.where('date').equals(date).first();
  const row: BodyweightEntry = { id: existing?.id ?? newId(), date, kg };
  await db.bodyweight.put(row);
  return row;
}

/** Bodyweight entries, oldest to newest. */
export async function listBodyweight(): Promise<BodyweightEntry[]> {
  const rows = await db.bodyweight.toArray();
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

export async function deleteBodyweight(id: string): Promise<void> {
  await db.bodyweight.delete(id);
}

/* ------------------------------------------------------------ export/import */

/** Everything in the database as a plain JSON-serialisable object. */
export async function exportAll(): Promise<ExportBundle> {
  const [templates, exercises, sessions, setLogs, settings, bodyweight] = await Promise.all([
    db.templates.toArray(),
    db.exercises.toArray(),
    db.sessions.toArray(),
    db.setLogs.toArray(),
    db.settings.toArray(),
    db.bodyweight.toArray(),
  ]);
  return {
    version: 1,
    exportedAt: Date.now(),
    templates,
    exercises,
    sessions,
    setLogs,
    settings,
    bodyweight,
  };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function hasId(v: unknown): v is Record<string, unknown> & { id: string } {
  return isObj(v) && typeof v.id === 'string' && v.id.length > 0;
}

/**
 * Merge a previously exported bundle into the database. Rows whose `id`
 * already exists are left untouched (never overwritten); malformed rows are
 * counted in `skipped`. Throws if the bundle is not an object.
 */
export async function importMerge(json: unknown): Promise<ImportCounts> {
  if (!isObj(json)) throw new Error('Import failed: expected a JSON object.');
  const counts: ImportCounts = {
    templates: 0,
    exercises: 0,
    sessions: 0,
    setLogs: 0,
    settings: 0,
    bodyweight: 0,
    skipped: 0,
  };

  const pick = (key: string): unknown[] => {
    const value = json[key];
    return Array.isArray(value) ? value : [];
  };

  interface MinimalTable<T> {
    get(id: string): Promise<T | undefined>;
    put(row: T): Promise<unknown>;
  }

  async function merge<T extends { id: string }>(
    table: MinimalTable<T>,
    rows: unknown[],
    valid: (row: Record<string, unknown>) => boolean,
    key: keyof ImportCounts,
  ): Promise<void> {
    for (const raw of rows) {
      if (!hasId(raw) || !valid(raw)) {
        counts.skipped++;
        continue;
      }
      const exists = await table.get(raw.id);
      if (exists) continue;
      await table.put(raw as unknown as T);
      counts[key]++;
    }
  }

  await db.transaction(
    'rw',
    [db.templates, db.exercises, db.sessions, db.setLogs, db.settings, db.bodyweight],
    async () => {
      await merge<Template>(
        db.templates,
        pick('templates'),
        (r) => typeof r.name === 'string' && typeof r.order === 'number',
        'templates',
      );
      await merge<Exercise>(
        db.exercises,
        pick('exercises'),
        (r) =>
          typeof r.templateId === 'string' &&
          typeof r.name === 'string' &&
          typeof r.sets === 'number' &&
          typeof r.repMin === 'number' &&
          typeof r.repMax === 'number',
        'exercises',
      );
      await merge<Session>(
        db.sessions,
        pick('sessions'),
        // `exercises` is the per-session snapshot: optional, but an array if present.
        (r) =>
          typeof r.templateId === 'string' &&
          typeof r.startedAt === 'number' &&
          (r.exercises === undefined || Array.isArray(r.exercises)),
        'sessions',
      );
      await merge<SetLog>(
        db.setLogs,
        pick('setLogs'),
        (r) =>
          typeof r.sessionId === 'string' &&
          typeof r.exerciseId === 'string' &&
          typeof r.setIndex === 'number' &&
          typeof r.load === 'number' &&
          typeof r.reps === 'number',
        'setLogs',
      );
      await merge<Settings>(
        db.settings,
        pick('settings'),
        (r) => typeof r.restPrimary === 'number' && typeof r.restAccessory === 'number',
        'settings',
      );
      await merge<BodyweightEntry>(
        db.bodyweight,
        pick('bodyweight'),
        (r) => typeof r.date === 'string' && typeof r.kg === 'number',
        'bodyweight',
      );
    },
  );

  return counts;
}

/** Deletes everything, then restores the stock programme and default settings. */
export async function wipeAll(database: WorkoutDB = db): Promise<void> {
  await database.transaction(
    'rw',
    [
      database.templates,
      database.exercises,
      database.sessions,
      database.setLogs,
      database.settings,
      database.bodyweight,
    ],
    async () => {
      await Promise.all([
        database.templates.clear(),
        database.exercises.clear(),
        database.sessions.clear(),
        database.setLogs.clear(),
        database.settings.clear(),
        database.bodyweight.clear(),
      ]);
      await database.templates.bulkPut(SEED_TEMPLATES);
      await database.exercises.bulkPut(SEED_EXERCISES);
      await database.settings.put({ ...DEFAULT_SETTINGS });
    },
  );
}
