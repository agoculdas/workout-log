import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkoutDB, backfillCatalogLinks, migrateToProgrammes } from './db';
import {
  DEFAULT_SETTINGS,
  SEED_CATALOG,
  SEED_EXERCISES,
  SEED_PROGRAMME_ID,
  SEED_TEMPLATES,
} from './seed';
import type { Exercise, Programme, Session, Template } from './types';

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

/** The four days as v1 and v2 wrote them: a `kind`, no programme, no tags. */
function legacyTemplates(): Array<Record<string, unknown>> {
  return SEED_TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    order: t.order,
    kind: t.tags.includes('lower') ? 'lower' : 'upper',
  }));
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
  await v1.table('templates').bulkPut(legacyTemplates());
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

    expect(db2.verno).toBe(3);
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
    expect(fresh.verno).toBe(3);
    expect(await fresh.catalog.count()).toBe(SEED_CATALOG.length);
    expect((await fresh.exercises.get('ex_deadlift'))?.catalogId).toBe('cat_barbell_deadlift');
  });
});

/* ------------------------------------------------------------- v2 -> v3 */

/** The v2 schema, exactly as the shipped version 2 declared it. */
function openV2(dbName: string): Dexie {
  const v2 = openV1(dbName);
  v2.version(2).stores({
    exercises: 'id, templateId, catalogId, [templateId+order]',
    catalog: 'id, name, *tags, *primary, archived',
  });
  return v2;
}

/** A v2 database: four `kind`-shaped days, no programmes table at all. */
async function seedV2(dbName: string, sessions: Session[] = []) {
  const v2 = openV2(dbName);
  await v2.open();
  expect(v2.verno).toBe(2);
  await v2.table('templates').bulkPut(legacyTemplates());
  await v2.table('exercises').bulkPut(SEED_EXERCISES);
  await v2.table('catalog').bulkPut(SEED_CATALOG);
  await v2.table('settings').put({ ...DEFAULT_SETTINGS });
  if (sessions.length) await v2.table('sessions').bulkPut(sessions);
  v2.close();
}

const session = (over: Partial<Session> & { id: string; templateId: string }): Session => ({
  startedAt: 1_000,
  finishedAt: 2_000,
  ...over,
});

describe('v2 -> v3 upgrade', () => {
  it('creates the stock programme with the fixed rotation', async () => {
    name = 'workout-v3-programme';
    await seedV2(name);

    const db3 = new WorkoutDB(name);
    opened = db3;
    await db3.open();

    expect(db3.verno).toBe(3);
    expect(await db3.programmes.count()).toBe(1);
    const programme = await db3.programmes.get(SEED_PROGRAMME_ID);
    expect(programme).toMatchObject({ name: 'Upper / Lower', active: true });
    expect(programme?.archived).toBe(false);
    expect(typeof programme?.createdAt).toBe('number');
    expect(programme?.rotation).toEqual([
      { templateId: 'lowerA' },
      { templateId: 'upperA' },
      { rest: true },
      { templateId: 'lowerB' },
      { templateId: 'upperB' },
      { rest: true },
      { rest: true },
    ]);
  });

  it('attaches every day to it and converts kind into tags', async () => {
    name = 'workout-v3-tags';
    await seedV2(name);

    const db3 = new WorkoutDB(name);
    opened = db3;
    await db3.open();

    const days = (await db3.templates.toArray()).sort((a, b) => a.order - b.order);
    expect(days.map((t) => t.id)).toEqual(['lowerA', 'upperA', 'lowerB', 'upperB']);
    expect(days.every((t) => t.programmeId === SEED_PROGRAMME_ID)).toBe(true);
    expect(days.map((t) => t.tags)).toEqual([
      ['lower', 'legs'],
      ['upper'],
      ['lower', 'legs'],
      ['upper'],
    ]);
    // The old discriminator is gone, not merely ignored.
    for (const day of days) expect('kind' in day).toBe(false);

    // The new compound index is usable.
    expect(
      (
        await db3.templates
          .where('[programmeId+order]')
          .between([SEED_PROGRAMME_ID, 0], [SEED_PROGRAMME_ID, 9])
          .toArray()
      ).map((t) => t.id),
    ).toEqual(['lowerA', 'upperA', 'lowerB', 'upperB']);
  });

  it('stamps templateName and programmeId onto existing sessions', async () => {
    name = 'workout-v3-sessions';
    await seedV2(name, [
      session({ id: 'old-1', templateId: 'lowerA' }),
      session({ id: 'old-2', templateId: 'upperB', templateName: 'Renamed by hand' }),
      // A session whose day no longer exists: nothing to copy from.
      session({ id: 'old-3', templateId: 'ghost' }),
    ]);

    const db3 = new WorkoutDB(name);
    opened = db3;
    await db3.open();

    const first = await db3.sessions.get('old-1');
    expect(first?.templateName).toBe('Lower A');
    expect(first?.programmeId).toBe(SEED_PROGRAMME_ID);
    // Old rows never get a slot: they resolve by first occurrence instead.
    expect(first?.slotIndex).toBeUndefined();

    // An existing snapshot is never overwritten.
    expect((await db3.sessions.get('old-2'))?.templateName).toBe('Renamed by hand');
    expect((await db3.sessions.get('old-2'))?.programmeId).toBe(SEED_PROGRAMME_ID);

    expect((await db3.sessions.get('old-3'))?.templateName).toBeUndefined();
    expect((await db3.sessions.get('old-3'))?.programmeId).toBeUndefined();
  });

  it('is idempotent: a second pass changes nothing', async () => {
    name = 'workout-v3-idempotent';
    await seedV2(name, [session({ id: 'old-1', templateId: 'lowerB' })]);

    const db3 = new WorkoutDB(name);
    opened = db3;
    await db3.open();

    const before = await db3.templates.toArray();
    const second = await migrateToProgrammes({
      programmes: db3.programmes,
      templates: db3.templates,
      sessions: db3.sessions,
    });
    expect(second).toEqual({ programmes: 0, templates: 0, sessions: 0 });
    expect(await db3.programmes.count()).toBe(1);
    expect(await db3.templates.toArray()).toEqual(before);
    expect((await db3.sessions.get('old-1'))?.templateName).toBe('Lower B');
  });

  it('does not steal the active flag from a programme that already has it', async () => {
    // Run the migration against in-memory tables: a database that already has
    // an active programme of its own still gets the stock row, but inactive.
    const programmes: Programme[] = [
      {
        id: 'mine',
        name: 'Mine',
        rotation: [{ templateId: 'day-1' }],
        active: true,
        createdAt: 1,
      },
    ];
    const templates: Template[] = [
      { id: 'day-1', programmeId: 'mine', name: 'My day', tags: ['push'], order: 0 },
    ];
    const counts = await migrateToProgrammes(
      {
        programmes: {
          toArray: async () => programmes,
          get: async (id: string) => programmes.find((p) => p.id === id),
          put: async (row: Programme) => programmes.push(row),
        },
        templates: {
          toArray: async () => templates,
          put: async () => undefined,
        },
        sessions: {
          toArray: async () => [],
          put: async () => undefined,
        },
      },
      5_000,
    );
    expect(counts.programmes).toBe(1);
    // The days already had a programme and tags, so nothing was rewritten.
    expect(counts.templates).toBe(0);
    const stock = programmes.find((p) => p.id === SEED_PROGRAMME_ID);
    expect(stock).toMatchObject({ active: false, createdAt: 5_000 });
    expect(programmes.find((p) => p.id === 'mine')?.active).toBe(true);
  });

  it('leaves a fresh install with one programme and four tagged days', async () => {
    name = 'workout-v3-fresh';
    const fresh = new WorkoutDB(name);
    opened = fresh;
    await fresh.open();
    await fresh.seed();
    expect(fresh.verno).toBe(3);
    expect(await fresh.programmes.count()).toBe(1);
    expect((await fresh.programmes.get(SEED_PROGRAMME_ID))?.active).toBe(true);
    expect((await fresh.templates.get('lowerA'))?.tags).toEqual(['lower', 'legs']);
    expect((await fresh.templates.get('upperA'))?.programmeId).toBe(SEED_PROGRAMME_ID);
  });
});
