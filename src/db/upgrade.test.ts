import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkoutDB, backfillCatalogLinks } from './db';
import { DEFAULT_SETTINGS, SEED_CATALOG, SEED_EXERCISES, SEED_TEMPLATES } from './seed';
import type { Exercise, Session } from './types';

/** Each test gets its own database name so they cannot see each other. */
let name = '';
let opened: WorkoutDB | undefined;

afterEach(() => {
  opened?.close();
  opened = undefined;
});

/** The v1 schema, exactly as the shipped version 1 declared it. */
function openV1(dbName: string): Dexie {
  const v1 = new Dexie(dbName);
  v1.version(1).stores({
    templates: 'id, order',
    exercises: 'id, templateId, [templateId+order]',
    sessions: 'id, startedAt, finishedAt, templateId',
    setLogs: 'id, sessionId, exerciseId, [sessionId+exerciseId]',
    settings: 'id',
    bodyweight: 'id, date',
  });
  return v1;
}

/** Seed exercises as v1 wrote them: no `catalogId` anywhere. */
function legacyExercises(): Exercise[] {
  return SEED_EXERCISES.map((exercise) => {
    const copy = { ...exercise };
    delete copy.catalogId;
    return copy;
  });
}

async function seedV1(dbName: string, extras: Exercise[] = [], sessions: Session[] = []) {
  const v1 = openV1(dbName);
  await v1.open();
  expect(v1.verno).toBe(1);
  await v1.table('templates').bulkPut(SEED_TEMPLATES);
  await v1.table('exercises').bulkPut([...legacyExercises(), ...extras]);
  await v1.table('settings').put({ ...DEFAULT_SETTINGS });
  if (sessions.length) await v1.table('sessions').bulkPut(sessions);
  expect(await v1.table('exercises').count()).toBe(28 + extras.length);
  v1.close();
}

const custom = (over: Partial<Exercise> & { id: string; name: string }): Exercise => ({
  templateId: 'lowerA',
  order: 50,
  sets: 3,
  repMin: 10,
  repMax: 10,
  measure: 'reps',
  perSide: false,
  unit: 'kg_total',
  increment: 2.5,
  type: 'accessory',
  archived: false,
  ...over,
});

describe('v1 -> v2 upgrade', () => {
  it('seeds the catalogue and links the exercises that were already there', async () => {
    name = 'workout-upgrade-basic';
    await seedV1(name, [
      // Matched by a case-insensitive name match against the catalogue.
      custom({ id: 'user-1', name: 'barbell ROW  ', templateId: 'upperB' }),
      // Nothing to match on: stays unlinked.
      custom({ id: 'user-2', name: 'Mystery machine', templateId: 'upperB' }),
    ]);

    const db2 = new WorkoutDB(name);
    opened = db2;
    await db2.open();

    expect(db2.verno).toBe(2);
    expect(await db2.catalog.count()).toBe(SEED_CATALOG.length);
    expect(await db2.exercises.count()).toBe(30);

    // Seed rows link by id, sharing entries where the movement is shared.
    expect((await db2.exercises.get('ex_hack_squat'))?.catalogId).toBe('cat_hack_squat');
    expect((await db2.exercises.get('ex_leg_curl_a'))?.catalogId).toBe('cat_leg_curl');
    expect((await db2.exercises.get('ex_leg_curl_b'))?.catalogId).toBe('cat_leg_curl');
    expect((await db2.exercises.get('ex_row_1km_ub'))?.catalogId).toBe('cat_row_1km');
    const unlinked = (await db2.exercises.toArray()).filter((e) => !e.catalogId);
    expect(unlinked.map((e) => e.id)).toEqual(['user-2']);

    // Name fallback for rows the id map knows nothing about.
    expect((await db2.exercises.get('user-1'))?.catalogId).toBe('cat_barbell_row');
    // The name itself is untouched — only the link is added.
    expect((await db2.exercises.get('user-1'))?.name).toBe('barbell ROW  ');

    // The new index is usable.
    expect(
      (await db2.exercises.where('catalogId').equals('cat_leg_curl').toArray()).map((e) => e.id),
    ).toEqual(['ex_leg_curl_a', 'ex_leg_curl_b']);
  });

  it('stamps catalogId into existing session snapshots', async () => {
    name = 'workout-upgrade-snapshots';
    const sessions: Session[] = [
      {
        id: 'old-1',
        templateId: 'lowerA',
        startedAt: 1_000,
        finishedAt: 2_000,
        exercises: [
          {
            id: 'ex_hack_squat',
            name: 'Hack squat (feet ahead, wide)',
            sets: 4,
            repMin: 8,
            repMax: 10,
            measure: 'reps',
            perSide: false,
            unit: 'kg_total',
            type: 'primary',
          },
          {
            id: 'gone-forever',
            name: 'Leg press',
            sets: 3,
            repMin: 12,
            repMax: 12,
            measure: 'reps',
            perSide: false,
            unit: 'kg_total',
            type: 'primary',
          },
          {
            id: 'gone-and-unknown',
            name: 'Some machine I made up',
            sets: 3,
            repMin: 12,
            repMax: 12,
            measure: 'reps',
            perSide: false,
            unit: 'kg_total',
            type: 'accessory',
          },
        ],
      },
      // A session from before snapshots existed: nothing to stamp.
      { id: 'old-2', templateId: 'upperA', startedAt: 3_000, finishedAt: 4_000 },
    ];
    await seedV1(name, [], sessions);

    const db2 = new WorkoutDB(name);
    opened = db2;
    await db2.open();

    const stamped = await db2.sessions.get('old-1');
    expect(stamped?.exercises?.map((e) => e.catalogId)).toEqual([
      'cat_hack_squat', // by seed id
      'cat_leg_press', // by name, even though the exercise row is gone
      undefined, // no match: left alone
    ]);
    // Prescriptions are not otherwise touched.
    expect(stamped?.exercises?.[0]).toMatchObject({ sets: 4, repMin: 8, repMax: 10 });
    expect((await db2.sessions.get('old-2'))?.exercises).toBeUndefined();
  });

  it('is idempotent: a second pass changes nothing', async () => {
    name = 'workout-upgrade-idempotent';
    await seedV1(name, [custom({ id: 'user-1', name: 'Face pull', templateId: 'upperB' })], [
      {
        id: 'old-1',
        templateId: 'lowerA',
        startedAt: 1_000,
        finishedAt: 2_000,
        exercises: [
          {
            id: 'ex_leg_press',
            name: 'Leg press',
            sets: 3,
            repMin: 12,
            repMax: 12,
            measure: 'reps',
            perSide: false,
            unit: 'kg_total',
            type: 'primary',
          },
        ],
      },
    ]);

    const db2 = new WorkoutDB(name);
    opened = db2;
    await db2.open();
    expect((await db2.exercises.get('user-1'))?.catalogId).toBe('cat_face_pull');

    const second = await backfillCatalogLinks({
      catalog: db2.catalog,
      exercises: db2.exercises,
      sessions: db2.sessions,
    });
    expect(second).toEqual({ catalog: 0, exercises: 0, snapshots: 0 });
    expect(await db2.catalog.count()).toBe(SEED_CATALOG.length);
    expect((await db2.sessions.get('old-1'))?.exercises?.[0]?.catalogId).toBe('cat_leg_press');
  });

  it('fills the catalogue on a fresh v2 database without an upgrade', async () => {
    name = 'workout-upgrade-fresh';
    const fresh = new WorkoutDB(name);
    opened = fresh;
    await fresh.open();
    await fresh.seed();
    expect(fresh.verno).toBe(2);
    expect(await fresh.catalog.count()).toBe(SEED_CATALOG.length);
    expect((await fresh.exercises.get('ex_deadlift'))?.catalogId).toBe('cat_barbell_deadlift');
  });
});
