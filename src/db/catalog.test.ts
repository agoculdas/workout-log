import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, ensureSeeded, resetSeedGuard } from './db';
import { SEED_CATALOG, SEED_EXERCISES } from './seed';
import {
  addExerciseFromCatalog,
  archiveCatalogEntry,
  archiveExercise,
  exportAll,
  finishSession,
  getCatalogEntry,
  getMuscleVolume,
  getPatternBalance,
  getSessionDetail,
  importMerge,
  listCatalog,
  listExercises,
  listExercisesForCatalog,
  logSet,
  renameCatalogEntry,
  startSession,
  updateSettings,
  upsertCatalogEntry,
  upsertExercise,
  wipeAll,
} from './repo';
import type { MuscleVolumeResult } from './types';

beforeEach(async () => {
  resetSeedGuard();
  await wipeAll();
  await ensureSeeded();
});

const muscle = (result: MuscleVolumeResult, name: string) =>
  result.rows.find((r) => r.muscle === name)!;

describe('catalogue seed', () => {
  it('seeds the whole catalogue and restores it on wipe', async () => {
    expect(await db.catalog.count()).toBe(SEED_CATALOG.length);
    expect(SEED_CATALOG).toHaveLength(44);
    await wipeAll();
    expect(await db.catalog.count()).toBe(SEED_CATALOG.length);
  });

  it('links every seeded exercise to an entry that exists', async () => {
    const ids = new Set(SEED_CATALOG.map((e) => e.id));
    const exercises = await listExercises();
    expect(exercises).toHaveLength(28);
    for (const exercise of exercises) {
      expect(exercise.catalogId, exercise.name).toBeTypeOf('string');
      expect(ids.has(exercise.catalogId!), exercise.name).toBe(true);
    }
    // Shared movements collapse onto one entry.
    expect(SEED_EXERCISES.filter((e) => e.catalogId === 'cat_leg_curl')).toHaveLength(2);
    expect(SEED_EXERCISES.filter((e) => e.catalogId === 'cat_calf_raises')).toHaveLength(2);
    expect(SEED_EXERCISES.filter((e) => e.catalogId === 'cat_row_1km')).toHaveLength(2);
  });

  it('tags every entry with its split, or marks it cardio / core', async () => {
    for (const entry of SEED_CATALOG) {
      if (entry.pattern === 'conditioning') {
        expect(entry.tags, entry.name).toEqual(['cardio']);
        continue;
      }
      if (entry.pattern === 'core') {
        expect(entry.tags, entry.name).toEqual(['core']);
        continue;
      }
      const hasSplit = entry.tags.some((t) => t === 'upper' || t === 'lower');
      const hasPpl = entry.tags.some((t) => t === 'push' || t === 'pull' || t === 'legs');
      const hasBodyPart = entry.tags.some((t) =>
        ['chest', 'back', 'shoulders', 'arms', 'legs', 'core'].includes(t),
      );
      expect([entry.name, hasSplit, hasPpl, hasBodyPart]).toEqual([entry.name, true, true, true]);
      expect(entry.primary.length, entry.name).toBeGreaterThan(0);
    }
  });
});

describe('listCatalog', () => {
  it('sorts by name and hides archived entries', async () => {
    const rows = await listCatalog();
    expect(rows).toHaveLength(SEED_CATALOG.length);
    expect(rows.map((r) => r.name)).toEqual(
      [...rows.map((r) => r.name)].sort((a, b) => a.localeCompare(b)),
    );

    await archiveCatalogEntry('cat_dips');
    expect((await listCatalog()).some((r) => r.id === 'cat_dips')).toBe(false);
    expect((await listCatalog({ includeArchived: true })).some((r) => r.id === 'cat_dips')).toBe(
      true,
    );
    await archiveCatalogEntry('cat_dips', false);
    expect((await listCatalog()).some((r) => r.id === 'cat_dips')).toBe(true);
  });

  it('filters by tag, muscle and name query', async () => {
    const cardio = await listCatalog({ tag: 'cardio' });
    expect(cardio.map((r) => r.id)).toEqual(['cat_row_1km']);

    const chest = await listCatalog({ tag: 'chest' });
    expect(chest.every((r) => r.tags.includes('chest'))).toBe(true);
    expect(chest.map((r) => r.id)).toContain('cat_barbell_bench_press');

    // A muscle filter matches primary *and* secondary movers.
    const glutes = await listCatalog({ muscle: 'glutes' });
    expect(glutes.map((r) => r.id)).toContain('cat_barbell_hip_thrust'); // primary
    expect(glutes.map((r) => r.id)).toContain('cat_hack_squat'); // secondary
    expect(glutes.map((r) => r.id)).not.toContain('cat_pushdowns');

    const query = await listCatalog({ query: 'SQUAT' });
    expect(query.map((r) => r.id)).toEqual([
      'cat_back_squat',
      'cat_bulgarian_split_squat',
      'cat_front_squat',
      'cat_hack_squat',
    ]);

    expect(await listCatalog({ tag: 'lower', query: 'curl' })).toHaveLength(1);
    expect(await listCatalog({ query: 'nothing here' })).toEqual([]);
  });
});

describe('catalogue CRUD', () => {
  it('creates, reads back, updates and archives an entry', async () => {
    const created = await upsertCatalogEntry({
      name: '  Belt squat  ',
      primary: ['quads', 'quads'],
      secondary: ['glutes', 'quads'],
      equipment: 'machine',
      pattern: 'squat',
      unilateral: false,
      tags: ['lower', 'legs', 'legs'],
      defaultUnit: 'kg_total',
      defaultMeasure: 'reps',
    });
    expect(created.id).toBeTypeOf('string');
    expect(created.name).toBe('Belt squat');
    // De-duplicated, and a primary is never repeated as secondary.
    expect(created.primary).toEqual(['quads']);
    expect(created.secondary).toEqual(['glutes']);
    expect(created.tags).toEqual(['lower', 'legs']);
    expect(created.archived).toBe(false);
    expect(await getCatalogEntry(created.id)).toMatchObject({ name: 'Belt squat' });

    const updated = await upsertCatalogEntry({ ...created, notes: 'Machine by the rack' });
    expect(updated.id).toBe(created.id);
    expect(updated.notes).toBe('Machine by the rack');
    expect(await db.catalog.count()).toBe(SEED_CATALOG.length + 1);

    await archiveCatalogEntry(created.id);
    expect((await getCatalogEntry(created.id))?.archived).toBe(true);
    expect(await getCatalogEntry('cat_nope')).toBeUndefined();
  });
});

describe('addExerciseFromCatalog', () => {
  it('applies the catalogue defaults', async () => {
    const added = await addExerciseFromCatalog('lowerA', 'cat_back_squat');
    expect(added).toMatchObject({
      templateId: 'lowerA',
      catalogId: 'cat_back_squat',
      name: 'Back squat',
      sets: 3,
      repMin: 10,
      repMax: 10,
      measure: 'reps',
      perSide: false,
      unit: 'kg_total',
      increment: 2.5,
      type: 'accessory',
      archived: false,
    });
    // Appended to the end of the day.
    expect(added.order).toBe(7);
    expect(await listExercises('lowerA')).toHaveLength(8);
  });

  it('takes perSide from `unilateral` and 0 increment from a bodyweight unit', async () => {
    const added = await addExerciseFromCatalog('lowerA', 'cat_bulgarian_split_squat');
    expect(added).toMatchObject({ perSide: true, unit: 'kg_side', increment: 2.5 });

    const plank = await addExerciseFromCatalog('upperA', 'cat_plank');
    expect(plank).toMatchObject({
      measure: 'seconds',
      repMin: 45,
      repMax: 45,
      unit: 'bodyweight',
      increment: 0,
      type: 'accessory',
    });

    const pullUp = await addExerciseFromCatalog('upperB', 'cat_pull_up');
    expect(pullUp).toMatchObject({ unit: 'bodyweight', increment: 0, repMin: 10, repMax: 10 });
  });

  it('uses conditioning type and a lap target where the entry says so', async () => {
    const row = await addExerciseFromCatalog('lowerB', 'cat_row_1km');
    expect(row).toMatchObject({
      type: 'conditioning',
      measure: 'seconds',
      repMin: 45,
      repMax: 45,
      unit: 'none',
      increment: 0,
    });

    const carry = await addExerciseFromCatalog('upperB', 'cat_farmers_walk');
    expect(carry).toMatchObject({ measure: 'laps', repMin: 1, repMax: 1, type: 'accessory' });
  });

  it('honours overrides, deriving the rest from them', async () => {
    const added = await addExerciseFromCatalog('lowerA', 'cat_back_squat', {
      name: '  Paused back squat ',
      sets: 5,
      repMin: 5,
      type: 'primary',
      unit: 'band',
    });
    expect(added).toMatchObject({
      name: 'Paused back squat',
      sets: 5,
      repMin: 5,
      // A lone repMin keeps the target fixed...
      repMax: 5,
      type: 'primary',
      // ...and the increment follows the overridden unit.
      unit: 'band',
      increment: 0,
    });

    const ranged = await addExerciseFromCatalog('lowerA', 'cat_front_squat', {
      repMin: 6,
      repMax: 8,
      increment: 5,
      measure: 'reps',
      perSide: true,
    });
    expect(ranged).toMatchObject({ repMin: 6, repMax: 8, increment: 5, perSide: true });
  });

  it('throws for an unknown entry', async () => {
    await expect(addExerciseFromCatalog('lowerA', 'cat_missing')).rejects.toThrow(/cat_missing/);
  });
});

describe('listExercisesForCatalog', () => {
  it('finds every programme row using a movement', async () => {
    const rows = await listExercisesForCatalog('cat_leg_curl');
    expect(rows.map((r) => r.id)).toEqual(['ex_leg_curl_a', 'ex_leg_curl_b']);

    await archiveExercise('ex_leg_curl_b');
    expect((await listExercisesForCatalog('cat_leg_curl')).map((r) => r.id)).toEqual([
      'ex_leg_curl_a',
    ]);
    expect(await listExercisesForCatalog('cat_leg_curl', true)).toHaveLength(2);
    expect(await listExercisesForCatalog('cat_plank')).toEqual([]);
  });
});

describe('renameCatalogEntry', () => {
  it('propagates to the programme when asked', async () => {
    const renamed = await renameCatalogEntry('cat_leg_curl', '  Lying leg curl  ', true);
    expect(renamed).toBe(2);
    expect((await getCatalogEntry('cat_leg_curl'))?.name).toBe('Lying leg curl');
    const rows = await listExercisesForCatalog('cat_leg_curl');
    expect(rows.map((r) => r.name)).toEqual(['Lying leg curl', 'Lying leg curl']);

    // Nothing left to change on a second pass.
    expect(await renameCatalogEntry('cat_leg_curl', 'Lying leg curl', true)).toBe(0);
  });

  it('leaves the programme alone when not asked', async () => {
    const renamed = await renameCatalogEntry('cat_calf_raises', 'Standing calf raise', false);
    expect(renamed).toBe(0);
    expect((await getCatalogEntry('cat_calf_raises'))?.name).toBe('Standing calf raise');
    expect((await listExercisesForCatalog('cat_calf_raises')).map((r) => r.name)).toEqual([
      'Calf raises',
      'Calf raises',
    ]);
  });

  it('renames archived programme rows too, and ignores an unknown entry', async () => {
    await archiveExercise('ex_calf_raises_b');
    expect(await renameCatalogEntry('cat_calf_raises', 'Calf raise', true)).toBe(2);
    expect(await renameCatalogEntry('cat_missing', 'Nope', true)).toBe(0);
  });
});

describe('session snapshots carry the catalogue link', () => {
  it('freezes catalogId and hands it back in the detail', async () => {
    const session = await startSession('lowerA');
    expect(session.exercises?.[0]).toMatchObject({
      id: 'ex_hack_squat',
      catalogId: 'cat_hack_squat',
    });

    const detail = await getSessionDetail(session.id);
    expect(detail?.exercises[0]?.catalogId).toBe('cat_hack_squat');

    // An exercise with no catalogue link snapshots without the key.
    const loose = await upsertExercise({
      templateId: 'upperA',
      name: 'Mystery machine',
      sets: 3,
      repMin: 10,
      repMax: 10,
      measure: 'reps',
      perSide: false,
      unit: 'kg_total',
      increment: 2.5,
      type: 'accessory',
    });
    const upper = await startSession('upperA');
    const snap = upper.exercises?.find((e) => e.id === loose.id);
    expect(snap).toBeDefined();
    expect(snap).not.toHaveProperty('catalogId');
  });
});

describe('getMuscleVolume', () => {
  /** Two finished sessions plus one unlinked exercise, at known times. */
  async function logHistory() {
    const first = await startSession('lowerA', 1_000);
    // Hack squat: quads primary, glutes + adductors secondary.
    await logSet({ sessionId: first.id, exerciseId: 'ex_hack_squat', setIndex: 0, load: 80, reps: 10, completedAt: 1_100 });
    await logSet({ sessionId: first.id, exerciseId: 'ex_hack_squat', setIndex: 1, load: 80, reps: 9, completedAt: 1_200 });
    // Leg curl: hamstrings primary, calves secondary.
    await logSet({ sessionId: first.id, exerciseId: 'ex_leg_curl_a', setIndex: 0, load: 40, reps: 10, completedAt: 1_300 });
    await finishSession(first.id);

    const second = await startSession('lowerA', 10_000);
    await logSet({ sessionId: second.id, exerciseId: 'ex_hack_squat', setIndex: 0, load: 85, reps: 8, completedAt: 10_100 });
    await finishSession(second.id);
    return { first, second };
  }

  it('shares sets out primary 1 / secondary 0.5 and counts sessions', async () => {
    const { first } = await logHistory();
    const result = await getMuscleVolume({ from: 0, to: 20_000 });

    expect(muscle(result, 'quads')).toMatchObject({ sets: 3, weightedSets: 3, sessions: 2 });
    expect(muscle(result, 'glutes')).toMatchObject({ sets: 0, weightedSets: 1.5, sessions: 2 });
    expect(muscle(result, 'adductors')).toMatchObject({ sets: 0, weightedSets: 1.5 });
    expect(muscle(result, 'hamstrings')).toMatchObject({ sets: 1, weightedSets: 1, sessions: 1 });
    expect(muscle(result, 'calves')).toMatchObject({ sets: 0, weightedSets: 0.5, sessions: 1 });
    expect(muscle(result, 'chest')).toMatchObject({ sets: 0, weightedSets: 0, sessions: 0 });
    expect(result.rows).toHaveLength(17);
    expect(result.unlinkedSets).toBe(0);
    expect(first.exercises?.length).toBe(7);
  });

  it('filters by window and ignores unfinished sessions', async () => {
    await logHistory();
    const early = await getMuscleVolume({ from: 0, to: 5_000 });
    expect(muscle(early, 'quads').sets).toBe(2);

    const late = await getMuscleVolume({ from: 5_000, to: 20_000 });
    expect(muscle(late, 'quads')).toMatchObject({ sets: 1, sessions: 1 });

    const none = await getMuscleVolume({ from: 100_000, to: 200_000 });
    expect(none.rows.every((r) => r.sets === 0 && r.weightedSets === 0)).toBe(true);

    // Sets logged in a session that was never finished do not count.
    const open = await startSession('lowerA', 30_000);
    await logSet({ sessionId: open.id, exerciseId: 'ex_hack_squat', setIndex: 0, load: 90, reps: 5, completedAt: 30_100 });
    const all = await getMuscleVolume({ from: 0, to: 40_000 });
    expect(muscle(all, 'quads').sets).toBe(3);
  });

  it('counts sets with no catalogue link separately', async () => {
    const loose = await upsertExercise({
      templateId: 'lowerA',
      name: 'Mystery machine',
      sets: 3,
      repMin: 10,
      repMax: 10,
      measure: 'reps',
      perSide: false,
      unit: 'kg_total',
      increment: 2.5,
      type: 'accessory',
    });
    const session = await startSession('lowerA', 1_000);
    await logSet({ sessionId: session.id, exerciseId: loose.id, setIndex: 0, load: 20, reps: 10, completedAt: 1_100 });
    await logSet({ sessionId: session.id, exerciseId: 'ex_hack_squat', setIndex: 0, load: 80, reps: 10, completedAt: 1_200 });
    await finishSession(session.id);

    const result = await getMuscleVolume({ from: 0, to: 5_000 });
    expect(result.unlinkedSets).toBe(1);
    expect(muscle(result, 'quads').sets).toBe(1);
  });

  it('resolves through the snapshot after the programme row is repointed', async () => {
    const session = await startSession('lowerA', 1_000);
    await logSet({ sessionId: session.id, exerciseId: 'ex_hack_squat', setIndex: 0, load: 80, reps: 10, completedAt: 1_100 });
    await finishSession(session.id);

    // The day now runs a bench press on the same row; history stays a squat.
    await upsertExercise({
      ...(await db.exercises.get('ex_hack_squat'))!,
      catalogId: 'cat_barbell_bench_press',
      name: 'Barbell bench press',
    });

    const result = await getMuscleVolume({ from: 0, to: 5_000 });
    expect(muscle(result, 'quads').sets).toBe(1);
    expect(muscle(result, 'chest').sets).toBe(0);
  });
});

describe('getPatternBalance', () => {
  it('weights the four buckets by logged sets', async () => {
    const lower = await startSession('lowerA', 1_000);
    // squat x2 (hack squat), isolation x1 (leg curl)
    await logSet({ sessionId: lower.id, exerciseId: 'ex_hack_squat', setIndex: 0, load: 80, reps: 10, completedAt: 1_100 });
    await logSet({ sessionId: lower.id, exerciseId: 'ex_hack_squat', setIndex: 1, load: 80, reps: 10, completedAt: 1_200 });
    await logSet({ sessionId: lower.id, exerciseId: 'ex_leg_curl_a', setIndex: 0, load: 40, reps: 10, completedAt: 1_300 });
    await finishSession(lower.id);

    const upper = await startSession('upperA', 2_000);
    // horizontal push x1, horizontal pull x2, vertical push x1
    await logSet({ sessionId: upper.id, exerciseId: 'ex_db_incline_bench', setIndex: 0, load: 24, reps: 10, completedAt: 2_100 });
    await logSet({ sessionId: upper.id, exerciseId: 'ex_seated_row', setIndex: 0, load: 55, reps: 12, completedAt: 2_200 });
    await logSet({ sessionId: upper.id, exerciseId: 'ex_seated_row', setIndex: 1, load: 55, reps: 12, completedAt: 2_300 });
    await logSet({ sessionId: upper.id, exerciseId: 'ex_seated_db_ohp', setIndex: 0, load: 16, reps: 10, completedAt: 2_400 });
    await finishSession(upper.id);

    const lowerB = await startSession('lowerB', 3_000);
    // hinge x1 (deadlift), conditioning x1 (row) — the row counts nowhere.
    await logSet({ sessionId: lowerB.id, exerciseId: 'ex_deadlift', setIndex: 0, load: 120, reps: 6, completedAt: 3_100 });
    await logSet({ sessionId: lowerB.id, exerciseId: 'ex_row_1km_b', setIndex: 0, load: 0, reps: 240, completedAt: 3_200 });
    await finishSession(lowerB.id);

    expect(await getPatternBalance({ from: 0, to: 5_000 })).toEqual({
      push: 2,
      pull: 2,
      squat: 2,
      hinge: 1,
    });

    // Same window rules as getMuscleVolume.
    expect(await getPatternBalance({ from: 2_000, to: 2_500 })).toEqual({
      push: 2,
      pull: 2,
      squat: 0,
      hinge: 0,
    });
    expect(await getPatternBalance({ from: 50_000, to: 60_000 })).toEqual({
      push: 0,
      pull: 0,
      squat: 0,
      hinge: 0,
    });
  });
});

describe('export / import with the catalogue', () => {
  it('exports the catalogue and merges it back without overwriting', async () => {
    const bundle = await exportAll();
    expect(bundle.catalog).toHaveLength(SEED_CATALOG.length);

    const again = await importMerge(JSON.parse(JSON.stringify(bundle)));
    expect(again).toMatchObject({ catalog: 0, skipped: 0 });

    // A foreign entry lands; an existing id is left exactly as it was.
    const counts = await importMerge({
      ...bundle,
      catalog: [
        {
          id: 'cat_sissy_squat',
          name: 'Sissy squat',
          primary: ['quads'],
          secondary: [],
          equipment: 'bodyweight',
          pattern: 'squat',
          unilateral: false,
          tags: ['lower', 'legs'],
          defaultUnit: 'bodyweight',
          defaultMeasure: 'reps',
        },
        { ...bundle.catalog![0]!, name: 'Renamed by the other device' },
        { id: 'cat_bad', name: 'Broken', primary: ['not_a_muscle'] },
        { name: 'No id at all', primary: [], secondary: [] },
      ],
    });
    expect(counts).toMatchObject({ catalog: 1, skipped: 2 });
    expect((await getCatalogEntry('cat_sissy_squat'))?.name).toBe('Sissy squat');
    expect((await getCatalogEntry(bundle.catalog![0]!.id))?.name).toBe(bundle.catalog![0]!.name);
  });

  it('accepts a bundle from before the catalogue existed', async () => {
    const bundle = await exportAll();
    const legacy: Record<string, unknown> = { ...bundle };
    delete legacy.catalog;

    const counts = await importMerge(legacy);
    expect(counts.catalog).toBe(0);
    expect(counts.skipped).toBe(0);
    expect(await db.catalog.count()).toBe(SEED_CATALOG.length);

    // …including one that also carries exercises with no catalogId.
    const fresh = await importMerge({
      version: 1,
      exportedAt: 1,
      exercises: [
        {
          id: 'ex_legacy',
          templateId: 'lowerA',
          name: 'Legacy machine',
          order: 99,
          sets: 3,
          repMin: 10,
          repMax: 10,
          measure: 'reps',
          perSide: false,
          unit: 'kg_total',
          increment: 2.5,
          type: 'accessory',
        },
      ],
    });
    expect(fresh.exercises).toBe(1);
    expect((await db.exercises.get('ex_legacy'))?.catalogId).toBeUndefined();
  });
});

describe('addExerciseFromCatalog — denomination', () => {
  it('takes the default denomination and its increment from Settings', async () => {
    const kg = await addExerciseFromCatalog('lowerA', 'cat_back_squat');
    expect(kg).toMatchObject({ massUnit: 'kg', increment: 2.5 });

    await updateSettings({ units: 'lb' });
    const lb = await addExerciseFromCatalog('lowerA', 'cat_front_squat');
    expect(lb).toMatchObject({ massUnit: 'lb', increment: 5 });

    // Nothing to load means no step, whatever the denomination.
    const plank = await addExerciseFromCatalog('upperA', 'cat_plank');
    expect(plank).toMatchObject({ massUnit: 'lb', unit: 'bodyweight', increment: 0 });

    // An override wins over the setting, and drags the increment with it.
    const forced = await addExerciseFromCatalog('lowerA', 'cat_leg_press', {
      massUnit: 'kg',
    });
    expect(forced).toMatchObject({ massUnit: 'kg', increment: 2.5 });
  });

  it('upsertExercise defaults a new row from Settings and keeps it on edit', async () => {
    await updateSettings({ units: 'lb' });
    const created = await upsertExercise({
      templateId: 'lowerA',
      name: 'Pin press',
      sets: 3,
      repMin: 10,
      repMax: 10,
      measure: 'reps',
      perSide: false,
      unit: 'kg_total',
      increment: 5,
      type: 'accessory',
    });
    expect(created.massUnit).toBe('lb');

    // Editing something else does not re-read the setting.
    await updateSettings({ units: 'kg' });
    const edited = await upsertExercise({ ...created, name: 'Pin press (top half)' });
    expect(edited.massUnit).toBe('lb');

    // Seeded rows have none, so they keep reading as kilograms.
    const seeded = await upsertExercise({
      ...(await db.exercises.get('ex_hack_squat'))!,
      sets: 5,
    });
    expect(seeded.massUnit).toBe('kg');
  });
});

describe('reports ignore warm-ups', () => {
  it('leaves warm-up sets out of the muscle tally and the pattern balance', async () => {
    const session = await startSession('lowerA', 1_000);
    // Hack squat: quads primary, glutes + adductors secondary, pattern squat.
    await logSet({ sessionId: session.id, exerciseId: 'ex_hack_squat', setIndex: 0, load: 40, reps: 10, completedAt: 1_050, kind: 'warmup' });
    await logSet({ sessionId: session.id, exerciseId: 'ex_hack_squat', setIndex: 1, load: 80, reps: 10, completedAt: 1_100 });
    await finishSession(session.id);

    const result = await getMuscleVolume({ from: 0, to: 5_000 });
    expect(muscle(result, 'quads')).toMatchObject({ sets: 1, weightedSets: 1, sessions: 1 });
    expect(muscle(result, 'glutes').weightedSets).toBe(0.5);
    expect(result.unlinkedSets).toBe(0);

    expect(await getPatternBalance({ from: 0, to: 5_000 })).toMatchObject({ squat: 1 });
  });
});
