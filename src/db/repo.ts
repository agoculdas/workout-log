/**
 * All database access for the UI goes through these plain async functions.
 * Screens can call them directly, or wrap them in `useLiveQuery` from
 * dexie-react-hooks to get reactive reads:
 *
 *   const exercises = useLiveQuery(() => listExercises('lowerA'), ['lowerA']);
 */
import { db, newId, type WorkoutDB } from './db';
import {
  DEFAULT_SETTINGS,
  SEED_CATALOG,
  SEED_EXERCISES,
  SEED_TEMPLATES,
  seedProgramme,
} from './seed';
import { getPreset } from './presets';
import { tallyMuscles } from '../logic/muscleVolume';
import { formatSetSummary } from '../logic/format';
import { warmupSets, workingSets } from '../logic/sets';
import { defaultIncrement, exerciseMassUnit } from '../logic/units';
import { topSetLoad, totalVolumeKg } from '../logic/volume';
import { EQUIPMENT, MUSCLES, PATTERNS } from './types';
import type {
  BodyweightEntry,
  CatalogEntry,
  Exercise,
  ExerciseSessionHistory,
  ExerciseSnapshot,
  ExportBundle,
  ImportCounts,
  MassUnit,
  Measure,
  Muscle,
  MuscleVolumeResult,
  PatternBalance,
  Programme,
  RotationSlot,
  Session,
  SetLog,
  Settings,
  SplitTag,
  Template,
} from './types';

export type { MuscleVolumeResult, MuscleVolumeRow, PatternBalance } from './types';
export { PRESETS, getPreset } from './presets';
export type { PresetDay, ProgrammePreset } from './presets';

/* ------------------------------------------------------------------ settings */

/**
 * Fills in fields a row written by an older version of the app never had, so
 * adding a setting never needs a schema bump or a migration.
 */
function withDefaults(row: Settings): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...row, id: 'settings' as const };
  return {
    ...merged,
    // Copy the containers so no caller can mutate DEFAULT_SETTINGS through a
    // row that fell back to it.
    plates: Array.isArray(row.plates) ? [...row.plates] : [...DEFAULT_SETTINGS.plates],
    setsPerMuscleTarget: {
      ...DEFAULT_SETTINGS.setsPerMuscleTarget,
      ...(row.setsPerMuscleTarget ?? {}),
    },
  };
}

export async function getSettings(): Promise<Settings> {
  const found = await db.settings.get('settings');
  if (found) return withDefaults(found);
  const fresh = withDefaults(DEFAULT_SETTINGS);
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

/**
 * Stamp "backed up just now". Called by the UI *after* a download or copy
 * actually succeeded — `exportAll()` deliberately does not, because producing
 * the text is not the same as the user keeping it.
 */
export async function markExported(): Promise<void> {
  await updateSettings({ lastExportAt: Date.now() });
}

/** The default denomination for new exercises, without a write-on-miss. */
async function defaultMassUnit(): Promise<MassUnit> {
  const settings = await readSettings();
  return settings?.units === 'lb' ? 'lb' : 'kg';
}

/* ---------------------------------------------------------------- programmes */

function byActiveThenAge(a: Programme, b: Programme): number {
  if (a.active !== b.active) return a.active ? -1 : 1;
  return a.createdAt - b.createdAt;
}

/** Saved programmes: the active one first, then oldest to newest. */
export async function listProgrammes(includeArchived = false): Promise<Programme[]> {
  const rows = await db.programmes.toArray();
  const visible = includeArchived ? rows : rows.filter((p) => !p.archived);
  return visible.sort(byActiveThenAge);
}

export async function getProgramme(id: string): Promise<Programme | undefined> {
  return db.programmes.get(id);
}

/**
 * Which programme is in charge, without writing anything - safe inside
 * `useLiveQuery`, where a write would retrigger the query it lives in. Falls
 * back to the newest non-archived programme when the flag has gone missing;
 * `getActiveProgramme` is the one that repairs it.
 */
async function resolveActiveProgramme(): Promise<Programme | undefined> {
  const rows = (await db.programmes.toArray()).filter((p) => !p.archived);
  if (!rows.length) return undefined;
  return (
    rows.find((p) => p.active) ??
    rows.reduce((newest, row) => (row.createdAt > newest.createdAt ? row : newest))
  );
}

/**
 * The active programme. Self-heals: if nothing is flagged active (an import, a
 * half-finished delete), the newest non-archived programme is promoted and the
 * flag written back. Throws only when there is no programme at all.
 */
export async function getActiveProgramme(): Promise<Programme> {
  const found = await resolveActiveProgramme();
  if (!found) throw new Error('No programme exists.');
  if (found.active) return found;
  await setActiveProgramme(found.id);
  return { ...found, active: true };
}

/** A new, empty programme: no days, no rotation, not active. */
export async function createProgramme(name: string): Promise<Programme> {
  const row: Programme = {
    id: newId(),
    name: name.trim() || 'New programme',
    rotation: [],
    active: false,
    createdAt: Date.now(),
    archived: false,
  };
  await db.programmes.put(row);
  return row;
}

/**
 * Rename a programme or rewrite its rotation. Every training slot must name a
 * non-archived day *of this programme* - a rotation is never allowed to point
 * at a day that is not there, so `pickNextSession` can trust it.
 */
export async function updateProgramme(
  id: string,
  patch: Partial<Pick<Programme, 'name' | 'rotation'>>,
): Promise<void> {
  await db.transaction('rw', db.programmes, db.templates, async () => {
    const programme = await db.programmes.get(id);
    if (!programme) throw new Error(`Unknown programme: ${id}`);
    const next: Programme = { ...programme };
    if (patch.name !== undefined) next.name = patch.name.trim() || programme.name;
    if (patch.rotation !== undefined) {
      const days = await db.templates.where('programmeId').equals(id).toArray();
      const usable = new Set(days.filter((t) => !t.archived).map((t) => t.id));
      for (const slot of patch.rotation) {
        if ('rest' in slot) continue;
        if (!usable.has(slot.templateId)) {
          throw new Error(`Rotation slot names an unknown day: ${slot.templateId}`);
        }
      }
      next.rotation = patch.rotation.map((slot) => ({ ...slot }));
    }
    await db.programmes.put(next);
  });
}

/** Make one programme active. Exactly one row carries the flag afterwards. */
export async function setActiveProgramme(id: string): Promise<void> {
  await db.transaction('rw', db.programmes, async () => {
    const target = await db.programmes.get(id);
    if (!target) throw new Error(`Unknown programme: ${id}`);
    if (target.archived) throw new Error('An archived programme cannot be made active.');
    for (const row of await db.programmes.toArray()) {
      const active = row.id === id;
      if (row.active === active) continue;
      await db.programmes.put({ ...row, active });
    }
  });
}

/**
 * A full copy under a new name: every non-archived day and its exercises get
 * fresh ids, and the rotation is remapped onto them. The copy is not active.
 */
export async function duplicateProgramme(id: string, name: string): Promise<Programme> {
  const source = await db.programmes.get(id);
  if (!source) throw new Error(`Unknown programme: ${id}`);
  const days = (await db.templates.where('programmeId').equals(id).toArray())
    .filter((t) => !t.archived)
    .sort((a, b) => a.order - b.order);

  const copyId = newId();
  const idMap = new Map<string, string>();
  for (const [index, day] of days.entries()) {
    const templateId = newId();
    idMap.set(day.id, templateId);
    await db.templates.put({
      id: templateId,
      programmeId: copyId,
      name: day.name,
      tags: [...day.tags],
      order: index,
      archived: false,
    });
    const exercises = (await db.exercises.where('templateId').equals(day.id).toArray())
      .filter((e) => !e.archived)
      .sort((a, b) => a.order - b.order);
    for (const [order, exercise] of exercises.entries()) {
      await db.exercises.put({ ...exercise, id: newId(), templateId, order });
    }
  }

  const rotation: RotationSlot[] = [];
  for (const slot of source.rotation) {
    if ('rest' in slot) {
      rotation.push({ rest: true });
      continue;
    }
    const mapped = idMap.get(slot.templateId);
    if (mapped) rotation.push({ templateId: mapped });
  }

  const copy: Programme = {
    id: copyId,
    name: name.trim() || `${source.name} copy`,
    rotation,
    active: false,
    createdAt: Date.now(),
    archived: false,
  };
  await db.programmes.put(copy);
  return copy;
}

/**
 * Retire a programme: its days and their exercises are archived and the
 * programme itself is flagged archived. Nothing is deleted, so finished
 * sessions keep resolving their snapshots. The active programme is refused -
 * make another one active first.
 */
export async function deleteProgramme(id: string): Promise<void> {
  const programme = await db.programmes.get(id);
  if (!programme) throw new Error(`Unknown programme: ${id}`);
  const active = await resolveActiveProgramme();
  if (active?.id === id) {
    throw new Error('The active programme cannot be deleted. Make another one active first.');
  }
  await db.transaction('rw', db.programmes, db.templates, db.exercises, async () => {
    const days = await db.templates.where('programmeId').equals(id).toArray();
    for (const day of days) {
      if (!day.archived) await db.templates.put({ ...day, archived: true });
      const exercises = await db.exercises.where('templateId').equals(day.id).toArray();
      for (const exercise of exercises) {
        if (!exercise.archived) await db.exercises.update(exercise.id, { archived: true });
      }
    }
    await db.programmes.put({ ...programme, active: false, archived: true });
  });
}

/**
 * Build a whole programme from one of the `PRESETS`. Each day's exercises come
 * through `addExerciseFromCatalog`, so the unit, measure, per-side flag,
 * denomination and increment are the catalogue's and Settings' business - the
 * preset only says which movement, how many sets, what rep range, and whether
 * it is a primary.
 */
export async function createProgrammeFromPreset(
  presetId: string,
  opts: { activate?: boolean } = {},
): Promise<Programme> {
  const preset = getPreset(presetId);
  if (!preset) throw new Error(`Unknown preset: ${presetId}`);

  const programmeId = newId();
  const templateIds: string[] = [];
  for (const [index, day] of preset.days.entries()) {
    const templateId = newId();
    templateIds.push(templateId);
    await db.templates.put({
      id: templateId,
      programmeId,
      name: day.name,
      tags: [...day.tags],
      order: index,
      archived: false,
    });
    for (const item of day.exercises) {
      await addExerciseFromCatalog(templateId, item.catalogId, {
        sets: item.sets,
        repMin: item.repMin,
        repMax: item.repMax,
        type: item.type,
      });
    }
  }

  const rotation: RotationSlot[] = preset.rotation.map((slot) => {
    if (slot === 'rest') return { rest: true };
    const templateId = templateIds[slot];
    return templateId ? { templateId } : { rest: true };
  });

  const programme: Programme = {
    id: programmeId,
    name: preset.name,
    rotation,
    active: false,
    createdAt: Date.now(),
    archived: false,
  };
  await db.programmes.put(programme);
  if (opts.activate) {
    await setActiveProgramme(programmeId);
    return { ...programme, active: true };
  }
  return programme;
}

/* ----------------------------------------------------------------- templates */

/**
 * A programme's days, in order. With no `programmeId` it is the *active*
 * programme's days - what Today, the day pickers and the library's "appears
 * in" hints all mean by "the programme". Archived days are hidden by default.
 *
 * A database with no programme row at all (only reachable mid-import) falls
 * back to every template, so no screen goes blank.
 */
export async function listTemplates(
  programmeId?: string,
  includeArchived = false,
): Promise<Template[]> {
  let id = programmeId;
  if (id === undefined) id = (await resolveActiveProgramme())?.id;
  const rows =
    id === undefined
      ? await db.templates.toArray()
      : await db.templates.where('programmeId').equals(id).toArray();
  const visible = includeArchived ? rows : rows.filter((t) => !t.archived);
  return visible.sort((a, b) => a.order - b.order);
}

/**
 * Every day in the database, whatever programme it belongs to. Used where a
 * session's day has to resolve regardless of which programme is active - the
 * clash rule in `pickNextSession` reads tags off days you are not running.
 */
export async function listAllTemplates(includeArchived = true): Promise<Template[]> {
  const rows = await db.templates.toArray();
  const visible = includeArchived ? rows : rows.filter((t) => !t.archived);
  return visible.sort((a, b) => a.order - b.order);
}

export async function getTemplate(id: string): Promise<Template | undefined> {
  return db.templates.get(id);
}

/** Append a day to a programme. */
export async function createTemplate(
  programmeId: string,
  input: { name: string; tags: SplitTag[] },
): Promise<Template> {
  const siblings = await db.templates.where('programmeId').equals(programmeId).toArray();
  const order = siblings.reduce((max, t) => Math.max(max, t.order + 1), 0);
  const row: Template = {
    id: newId(),
    programmeId,
    name: input.name.trim() || 'New day',
    tags: [...new Set(input.tags)],
    order,
    archived: false,
  };
  await db.templates.put(row);
  return row;
}

export async function updateTemplate(
  id: string,
  patch: Partial<Pick<Template, 'name' | 'tags'>>,
): Promise<void> {
  const row = await db.templates.get(id);
  if (!row) throw new Error(`Unknown day: ${id}`);
  const next: Template = { ...row };
  if (patch.name !== undefined) next.name = patch.name.trim() || row.name;
  if (patch.tags !== undefined) next.tags = [...new Set(patch.tags)];
  await db.templates.put(next);
}

/**
 * Rewrite `order` for a programme's days from the given id sequence. Ids not
 * in the list keep their relative order and are appended after.
 */
export async function reorderTemplates(
  programmeId: string,
  orderedIds: string[],
): Promise<void> {
  await db.transaction('rw', db.templates, async () => {
    const rows = await db.templates.where('programmeId').equals(programmeId).toArray();
    const byId = new Map(rows.map((r) => [r.id, r]));
    let order = 0;
    for (const id of orderedIds) {
      const row = byId.get(id);
      if (!row) continue;
      await db.templates.update(id, { order: order++ });
      byId.delete(id);
    }
    const rest = [...byId.values()].sort((a, b) => a.order - b.order);
    for (const row of rest) {
      await db.templates.update(row.id, { order: order++ });
    }
  });
}

/**
 * Retire a day: it leaves its programme's rotation, its exercises are archived
 * and it disappears from the pickers. Sessions keep their snapshots, so
 * history still reads the same.
 */
export async function archiveTemplate(id: string): Promise<void> {
  await db.transaction('rw', db.programmes, db.templates, db.exercises, async () => {
    const template = await db.templates.get(id);
    if (!template) return;
    if (!template.archived) await db.templates.put({ ...template, archived: true });

    const programme = await db.programmes.get(template.programmeId);
    if (programme) {
      const rotation = programme.rotation.filter(
        (slot) => 'rest' in slot || slot.templateId !== id,
      );
      if (rotation.length !== programme.rotation.length) {
        await db.programmes.put({ ...programme, rotation });
      }
    }

    for (const exercise of await db.exercises.where('templateId').equals(id).toArray()) {
      if (!exercise.archived) await db.exercises.update(exercise.id, { archived: true });
    }
  });
}

/* ----------------------------------------------------------------- exercises */

/**
 * Exercises for one day, sorted by `order`. Archived rows are excluded unless
 * `includeArchived`.
 *
 * With no `templateId` it is *the active programme's* exercises - every
 * non-archived day of it, in rotation order then list order. That is what the
 * library's "appears in" hints and History's exercise index mean by "the
 * programme"; days belonging to other (or retired) programmes stay out of it.
 */
export async function listExercises(
  templateId?: string,
  includeArchived = false,
): Promise<Exercise[]> {
  if (templateId) {
    const rows = await db.exercises.where('templateId').equals(templateId).toArray();
    const visible = includeArchived ? rows : rows.filter((e) => !e.archived);
    return visible.sort((a, b) => a.order - b.order);
  }

  const days = await listTemplates(undefined, includeArchived);
  const rank = new Map(days.map((t, i) => [t.id, i]));
  const rows = await db.exercises.toArray();
  const visible = rows.filter(
    (e) => (includeArchived || !e.archived) && rank.has(e.templateId),
  );
  return visible.sort(
    (a, b) =>
      (rank.get(a.templateId) ?? 0) - (rank.get(b.templateId) ?? 0) || a.order - b.order,
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
 * omit `order` on create and it is appended to the end of its template. A new
 * row with no `massUnit` takes the one from Settings; an existing row keeps
 * the denomination it already had unless the patch names another.
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
  const massUnit = input.massUnit ?? existing?.massUnit ?? (await defaultMassUnit());
  const row: Exercise = {
    archived: false,
    ...existing,
    ...input,
    id,
    order,
    massUnit,
  };
  await db.exercises.put(row);
  return row;
}

/**
 * Rewrite `order` for a template from the given id sequence. Ids not in the
 * list keep their relative order and are appended after.
 */
export async function reorderExercises(
  templateId: string,
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

/* ----------------------------------------------------------------- catalogue */

function unique<T>(values: readonly T[] | undefined): T[] {
  return values ? [...new Set(values)] : [];
}

export interface ListCatalogOptions {
  includeArchived?: boolean;
  /** Keep entries carrying this split tag. */
  tag?: SplitTag;
  /** Keep entries that train this muscle, primary *or* secondary. */
  muscle?: Muscle;
  /** Case-insensitive substring of the name. */
  query?: string;
}

/** The catalogue, sorted by name. Archived entries are hidden by default. */
export async function listCatalog(opts: ListCatalogOptions = {}): Promise<CatalogEntry[]> {
  const rows = await db.catalog.toArray();
  const query = opts.query?.trim().toLowerCase();
  const matches = rows.filter((row) => {
    if (!opts.includeArchived && row.archived) return false;
    if (opts.tag && !row.tags?.includes(opts.tag)) return false;
    if (
      opts.muscle &&
      !row.primary?.includes(opts.muscle) &&
      !row.secondary?.includes(opts.muscle)
    ) {
      return false;
    }
    if (query && !row.name.toLowerCase().includes(query)) return false;
    return true;
  });
  return matches.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getCatalogEntry(id: string): Promise<CatalogEntry | undefined> {
  return db.catalog.get(id);
}

/** Look up many entries at once, keyed by id. */
export async function getCatalogEntriesByIds(
  ids: string[],
): Promise<Map<string, CatalogEntry>> {
  const rows = await db.catalog.bulkGet([...new Set(ids)]);
  const map = new Map<string, CatalogEntry>();
  rows.forEach((row) => {
    if (row) map.set(row.id, row);
  });
  return map;
}

export type NewCatalogEntry = Omit<CatalogEntry, 'id'> & { id?: string };

/**
 * Create or update a catalogue entry. Omit `id` to create one (a UUID is
 * assigned — the stock entries use `cat_<slug>` ids instead). Muscle and tag
 * lists are de-duplicated, and a muscle listed as primary is dropped from
 * secondary so it cannot be counted twice.
 */
export async function upsertCatalogEntry(input: NewCatalogEntry): Promise<CatalogEntry> {
  const id = input.id ?? newId();
  const existing = input.id ? await db.catalog.get(input.id) : undefined;
  const primary = unique(input.primary);
  const row: CatalogEntry = {
    archived: false,
    ...existing,
    ...input,
    id,
    name: input.name.trim(),
    primary,
    secondary: unique(input.secondary).filter((m) => !primary.includes(m)),
    tags: unique(input.tags),
  };
  await db.catalog.put(row);
  return row;
}

/** Soft delete: hidden from pickers, still resolves for exercises using it. */
export async function archiveCatalogEntry(id: string, archived = true): Promise<void> {
  await db.catalog.update(id, { archived });
}

/**
 * Rename a catalogue entry. With `propagateToExercises`, every programme row
 * pointing at it (archived ones included) is renamed too. Returns how many
 * exercises were renamed — 0 when propagation is off or nothing differed.
 */
export async function renameCatalogEntry(
  id: string,
  name: string,
  propagateToExercises: boolean,
): Promise<number> {
  const next = name.trim();
  return db.transaction('rw', db.catalog, db.exercises, async () => {
    const entry = await db.catalog.get(id);
    if (!entry) return 0;
    await db.catalog.update(id, { name: next });
    if (!propagateToExercises) return 0;
    const rows = await db.exercises.where('catalogId').equals(id).toArray();
    let renamed = 0;
    for (const row of rows) {
      if (row.name === next) continue;
      await db.exercises.update(row.id, { name: next });
      renamed++;
    }
    return renamed;
  });
}

/** Where this movement appears in the programme, in template then list order. */
export async function listExercisesForCatalog(
  catalogId: string,
  includeArchived = false,
): Promise<Exercise[]> {
  const rows = await db.exercises.where('catalogId').equals(catalogId).toArray();
  const visible = includeArchived ? rows : rows.filter((e) => !e.archived);
  return visible.sort((a, b) =>
    a.templateId === b.templateId
      ? a.order - b.order
      : a.templateId.localeCompare(b.templateId),
  );
}

/** Starting target for a measure: 10 reps, 45 seconds or 1 lap, all fixed. */
export function defaultTargetFor(measure: Measure): { repMin: number; repMax: number } {
  switch (measure) {
    case 'seconds':
      return { repMin: 45, repMax: 45 };
    case 'laps':
      return { repMin: 1, repMax: 1 };
    case 'reps':
      return { repMin: 10, repMax: 10 };
  }
}

export type CatalogExerciseOverrides = Partial<
  Pick<
    Exercise,
    | 'sets'
    | 'repMin'
    | 'repMax'
    | 'increment'
    | 'type'
    | 'perSide'
    | 'unit'
    | 'massUnit'
    | 'measure'
    | 'name'
  >
>;

/**
 * Append a catalogue movement to a day as a programme exercise.
 *
 * Defaults: the entry's name, `defaultUnit`, `defaultMeasure` and `unilateral`
 * (as `perSide`); the denomination from Settings; 3 sets; a fixed target from
 * `defaultTargetFor`; an increment from `defaultIncrement` (so an lb exercise
 * starts at 5 lb, a kg one at 2.5 kg); type `accessory`, or `conditioning` when the
 * entry's pattern is. `overrides` win, and are applied before the derived
 * defaults are computed — override the unit and you get that unit's increment,
 * override the measure and you get that measure's target. Passing `repMin`
 * alone keeps the target fixed at that number.
 *
 * Throws when `catalogId` is not in the catalogue.
 */
export async function addExerciseFromCatalog(
  templateId: string,
  catalogId: string,
  overrides: CatalogExerciseOverrides = {},
): Promise<Exercise> {
  const entry = await db.catalog.get(catalogId);
  if (!entry) throw new Error(`Unknown catalogue entry: ${catalogId}`);

  const unit = overrides.unit ?? entry.defaultUnit;
  const massUnit = overrides.massUnit ?? (await defaultMassUnit());
  const measure = overrides.measure ?? entry.defaultMeasure;
  const target = defaultTargetFor(measure);
  const repMin = overrides.repMin ?? target.repMin;
  const repMax = overrides.repMax ?? overrides.repMin ?? target.repMax;

  return upsertExercise({
    templateId,
    catalogId: entry.id,
    name: overrides.name?.trim() || entry.name,
    sets: overrides.sets ?? 3,
    repMin,
    repMax,
    measure,
    perSide: overrides.perSide ?? entry.unilateral,
    unit,
    massUnit,
    increment: overrides.increment ?? defaultIncrement(unit, massUnit),
    type:
      overrides.type ?? (entry.pattern === 'conditioning' ? 'conditioning' : 'accessory'),
    archived: false,
  });
}

/* ---------------------------------------------------------- muscle analytics */

/** Logged sets from finished sessions in `[from, to]`, plus how to resolve them. */
async function loadWindow(opts: { from: number; to: number }): Promise<{
  sets: SetLog[];
  resolve: (exerciseId: string) => CatalogEntry | undefined;
}> {
  const [sessions, setLogs, exercises, catalog] = await Promise.all([
    db.sessions.toArray(),
    db.setLogs.toArray(),
    db.exercises.toArray(),
    db.catalog.toArray(),
  ]);

  const finished = new Set(
    sessions.filter((s) => s.finishedAt !== undefined).map((s) => s.id),
  );
  // Warm-ups train nothing as far as the reports are concerned.
  const sets = workingSets(setLogs).filter(
    (s) =>
      finished.has(s.sessionId) && s.completedAt >= opts.from && s.completedAt <= opts.to,
  );

  // Snapshot links win over the live row, so an exercise that was later
  // repointed (or deleted) still counts toward what it was on the day.
  const catalogIdByExercise = new Map<string, string>();
  for (const session of sessions) {
    for (const snapshot of session.exercises ?? []) {
      if (snapshot.catalogId && !catalogIdByExercise.has(snapshot.id)) {
        catalogIdByExercise.set(snapshot.id, snapshot.catalogId);
      }
    }
  }
  for (const exercise of exercises) {
    if (exercise.catalogId && !catalogIdByExercise.has(exercise.id)) {
      catalogIdByExercise.set(exercise.id, exercise.catalogId);
    }
  }

  const entryById = new Map(catalog.map((entry) => [entry.id, entry]));
  const resolve = (exerciseId: string): CatalogEntry | undefined => {
    const catalogId = catalogIdByExercise.get(exerciseId);
    return catalogId ? entryById.get(catalogId) : undefined;
  };
  return { sets, resolve };
}

/**
 * Sets per muscle over a window (both bounds inclusive), counting only sets
 * logged in finished sessions. A set counts 1 for each primary muscle of its
 * catalogue entry and 0.5 for each secondary one; sets whose exercise has no
 * catalogue link land in `unlinkedSets`. One row per muscle, `MUSCLES` order.
 */
export async function getMuscleVolume(opts: {
  from: number;
  to: number;
}): Promise<MuscleVolumeResult> {
  const { sets, resolve } = await loadWindow(opts);
  return tallyMuscles(sets, resolve);
}

/**
 * Logged sets grouped into push / pull / squat / hinge over the same window.
 * `push` is horizontal + vertical push, `pull` is horizontal + vertical pull;
 * lunge, carry, isolation, core and conditioning sets count toward none of
 * the four.
 */
export async function getPatternBalance(opts: {
  from: number;
  to: number;
}): Promise<PatternBalance> {
  const { sets, resolve } = await loadWindow(opts);
  const balance: PatternBalance = { push: 0, pull: 0, squat: 0, hinge: 0 };
  for (const set of sets) {
    const pattern = resolve(set.exerciseId)?.pattern;
    if (pattern === 'horizontal_push' || pattern === 'vertical_push') balance.push++;
    else if (pattern === 'horizontal_pull' || pattern === 'vertical_pull') balance.pull++;
    else if (pattern === 'squat') balance.squat++;
    else if (pattern === 'hinge') balance.hinge++;
  }
  return balance;
}

/* ------------------------------------------------------------------ sessions */

/**
 * The prescription fields a session freezes for each of its exercises, plus
 * the catalogue link so muscle volume can be worked out from the snapshot even
 * after the programme row is edited or deleted. `catalogId` is omitted (not
 * written as `undefined`) for exercises that have no catalogue entry.
 */
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
    massUnit: exerciseMassUnit(exercise),
    type: exercise.type,
    ...(exercise.catalogId ? { catalogId: exercise.catalogId } : {}),
  };
}

/** What `startSession` freezes besides the exercises. */
export interface StartSessionOptions {
  startedAt?: number;
  /** The rotation slot this session came from, so the walk can resume at it. */
  slotIndex?: number;
}

/**
 * Starts (and persists) a new session. Partial sessions are saved as you go.
 *
 * Everything the session needs to describe itself later is snapshotted here:
 * the day's exercises (so editing the Programme mid-session cannot reorder or
 * rename what you are logging), the day's name and programme (so history
 * survives a rename or a retired day), and the rotation slot it came from.
 *
 * The old positional form, `startSession(templateId, startedAt)`, still works.
 */
export async function startSession(
  templateId: string,
  startedAt?: number,
): Promise<Session>;
export async function startSession(
  templateId: string,
  opts?: StartSessionOptions,
): Promise<Session>;
export async function startSession(
  templateId: string,
  arg?: number | StartSessionOptions,
): Promise<Session> {
  const opts: StartSessionOptions = typeof arg === 'number' ? { startedAt: arg } : (arg ?? {});
  const [template, exerciseRows] = await Promise.all([
    db.templates.get(templateId),
    listExercises(templateId),
  ]);
  const session: Session = {
    id: newId(),
    templateId,
    startedAt: opts.startedAt ?? Date.now(),
    exercises: exerciseRows.map(exerciseSnapshot),
    ...(template ? { templateName: template.name, programmeId: template.programmeId } : {}),
    ...(opts.slotIndex === undefined || opts.slotIndex < 0
      ? {}
      : { slotIndex: opts.slotIndex }),
  };
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
  /** The live day row, when it still exists. */
  template: Template | undefined;
  /** The session's own snapshot of the day's name, else the live row's. */
  templateName: string;
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
  templateId: string,
  order: number,
): Exercise {
  return {
    templateId: live?.templateId ?? templateId,
    order: live?.order ?? order,
    increment: live?.increment ?? 0,
    archived: live?.archived,
    ...snapshot,
    // A session logged before the catalogue existed falls back to the live row.
    catalogId: snapshot.catalogId ?? live?.catalogId,
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
  return {
    session,
    template,
    templateName: session.templateName ?? template?.name ?? session.templateId,
    exercises,
    setsByExercise,
    sets,
  };
}

/** One exercise's line in the finish summary. */
export interface SessionSummaryExercise {
  exerciseId: string;
  name: string;
  /** `formatSetSummary` over the working sets, e.g. "4×10 @ 70 kg". */
  summary: string;
  /** How many of this exercise's sets the user marked "to failure". */
  toFailure: number;
  /** Top working set beat the previous completed session's. False with no history. */
  progressed: boolean;
  /** Top working-set load in the previous completed session, when there was one. */
  previousTop?: number;
  /** Top working-set load this session, when anything working was logged. */
  top?: number;
  /** The denomination `top` / `previousTop` are in. */
  massUnit: MassUnit;
}

/** What the Finish sheet shows. Loads stay in each exercise's own denomination. */
export interface SessionSummary {
  session: Session;
  templateName: string;
  /** `(finishedAt ?? now) - startedAt`. */
  durationMs: number;
  /** Working sets logged across the session. */
  setsLogged: number;
  /** Warm-up sets, counted separately and nowhere else. */
  warmups: number;
  /** Working-set volume in kilograms, converted per set — honest across units. */
  volumeKg: number;
  /** One row per exercise that has at least one logged set, in session order. */
  exercises: SessionSummaryExercise[];
}

/**
 * The post-Finish summary: how long it took, what was logged, and where you
 * moved up. "Progressed" compares the top working set against the previous
 * *completed* session of that exercise, in the exercise's own denomination —
 * no history means no claim.
 */
export async function getSessionSummary(
  sessionId: string,
): Promise<SessionSummary | undefined> {
  const detail = await getSessionDetail(sessionId);
  if (!detail) return undefined;
  const { session, templateName, exercises, setsByExercise, sets } = detail;

  const rows: SessionSummaryExercise[] = [];
  for (const exercise of exercises) {
    const logged = setsByExercise[exercise.id] ?? [];
    if (!logged.length) continue;

    const history = await getExerciseHistory(exercise.id);
    const previous = history
      .filter(
        (h) =>
          h.session.id !== session.id &&
          h.session.finishedAt !== undefined &&
          h.session.startedAt < session.startedAt,
      )
      .sort((a, b) => a.session.startedAt - b.session.startedAt)
      .pop();

    const working = workingSets(logged);
    const previousWorking = previous ? workingSets(previous.sets) : [];
    const top = working.length ? topSetLoad(working) : undefined;
    const previousTop = previousWorking.length ? topSetLoad(previousWorking) : undefined;

    rows.push({
      exerciseId: exercise.id,
      name: exercise.name,
      summary: formatSetSummary(exercise, logged),
      toFailure: logged.filter((s) => s.toFailure).length,
      progressed: top !== undefined && previousTop !== undefined && top > previousTop,
      ...(previousTop === undefined ? {} : { previousTop }),
      ...(top === undefined ? {} : { top }),
      massUnit: exerciseMassUnit(exercise),
    });
  }

  return {
    session,
    templateName,
    durationMs: Math.max(0, (session.finishedAt ?? Date.now()) - session.startedAt),
    setsLogged: workingSets(sets).length,
    warmups: warmupSets(sets).length,
    volumeKg: totalVolumeKg(sets),
    exercises: rows,
  };
}

/* ---------------------------------------------------------------------- sets */

export interface LogSetInput {
  sessionId: string;
  exerciseId: string;
  setIndex: number;
  load: number;
  reps: number;
  completedAt?: number;
  /** `'warmup'` for a warm-up row; omit for a working set. */
  kind?: SetLog['kind'];
  /** A fact the user marked. Never read by progression. */
  toFailure?: boolean;
  /** Omit and the exercise's own denomination is stamped on. */
  massUnit?: MassUnit;
}

/**
 * Record one completed set. Upserts on (sessionId, exerciseId, setIndex), so
 * re-tapping "done" on the same set corrects it instead of duplicating it.
 * The denomination is stamped from the exercise at log time, so editing the
 * exercise later never re-reads old numbers. The row is rebuilt from `input`
 * on every call, so pass `kind` and `toFailure` again when correcting a set
 * (or patch the row with `updateSet`).
 */
export async function logSet(input: LogSetInput): Promise<SetLog> {
  const massUnit =
    input.massUnit ?? exerciseMassUnit(await db.exercises.get(input.exerciseId));
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
      massUnit,
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.toFailure === undefined ? {} : { toFailure: input.toFailure }),
    };
    await db.setLogs.put(row);
    return row;
  });
}

/**
 * Patch one logged set in place. `kind` (warm-up / working), `toFailure`,
 * `load`, `reps`, `massUnit` and `completedAt` are all fair game; the session
 * and exercise it belongs to are not.
 */
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
  const [templates, programmes, exercises, sessions, setLogs, settings, bodyweight, catalog] =
    await Promise.all([
      db.templates.toArray(),
      db.programmes.toArray(),
      db.exercises.toArray(),
      db.sessions.toArray(),
      db.setLogs.toArray(),
      db.settings.toArray(),
      db.bodyweight.toArray(),
      db.catalog.toArray(),
    ]);
  return {
    version: 1,
    exportedAt: Date.now(),
    templates,
    programmes,
    exercises,
    sessions,
    setLogs,
    settings,
    bodyweight,
    catalog,
  };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
/** A muscle list: an array of names from `MUSCLES` (empty is fine). */
function isMuscleList(v: unknown): boolean {
  return (
    Array.isArray(v) && v.every((m) => typeof m === 'string' && (MUSCLES as readonly string[]).includes(m))
  );
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
    programmes: 0,
    exercises: 0,
    sessions: 0,
    setLogs: 0,
    settings: 0,
    bodyweight: 0,
    catalog: 0,
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

  // Days arriving without a programme (a v2 bundle) join whichever programme
  // is active here; their `kind` becomes tags the way the v3 upgrade does it.
  const fallbackProgrammeId = (await resolveActiveProgramme())?.id;

  await db.transaction(
    'rw',
    [
      db.templates,
      db.programmes,
      db.exercises,
      db.sessions,
      db.setLogs,
      db.settings,
      db.bodyweight,
      db.catalog,
    ],
    async () => {
      // Bundles exported before the catalogue existed simply have no `catalog`
      // key; `pick` yields an empty list and nothing is merged.
      await merge<CatalogEntry>(
        db.catalog,
        pick('catalog'),
        (r) =>
          typeof r.name === 'string' &&
          isMuscleList(r.primary) &&
          isMuscleList(r.secondary) &&
          typeof r.equipment === 'string' &&
          (EQUIPMENT as readonly string[]).includes(r.equipment) &&
          typeof r.pattern === 'string' &&
          (PATTERNS as readonly string[]).includes(r.pattern) &&
          typeof r.unilateral === 'boolean' &&
          Array.isArray(r.tags) &&
          r.tags.every((t) => typeof t === 'string') &&
          typeof r.defaultUnit === 'string' &&
          typeof r.defaultMeasure === 'string',
        'catalog',
      );
      await merge<Programme>(
        db.programmes,
        pick('programmes'),
        (r) => typeof r.name === 'string' && Array.isArray(r.rotation),
        'programmes',
      );
      await merge<Template>(
        db.templates,
        pick('templates').map((raw) => {
          if (!isObj(raw)) return raw;
          const legacy = raw as Record<string, unknown> & { kind?: unknown };
          const row: Record<string, unknown> = { ...legacy };
          delete row.kind;
          if (typeof row.programmeId !== 'string' && fallbackProgrammeId) {
            row.programmeId = fallbackProgrammeId;
          }
          if (!Array.isArray(row.tags)) {
            row.tags =
              legacy.kind === 'lower'
                ? ['lower', 'legs']
                : legacy.kind === 'upper'
                  ? ['upper']
                  : [];
          }
          return row;
        }),
        (r) =>
          typeof r.name === 'string' &&
          typeof r.order === 'number' &&
          typeof r.programmeId === 'string' &&
          Array.isArray(r.tags),
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
      database.programmes,
      database.exercises,
      database.sessions,
      database.setLogs,
      database.settings,
      database.bodyweight,
      database.catalog,
    ],
    async () => {
      await Promise.all([
        database.templates.clear(),
        database.programmes.clear(),
        database.exercises.clear(),
        database.sessions.clear(),
        database.setLogs.clear(),
        database.settings.clear(),
        database.bodyweight.clear(),
        database.catalog.clear(),
      ]);
      await database.programmes.put(seedProgramme());
      await database.templates.bulkPut(SEED_TEMPLATES.map((t) => ({ ...t })));
      await database.exercises.bulkPut(SEED_EXERCISES);
      await database.catalog.bulkPut(SEED_CATALOG);
      await database.settings.put({ ...DEFAULT_SETTINGS });
    },
  );
}
