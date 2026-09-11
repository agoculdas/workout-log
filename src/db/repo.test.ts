import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, ensureSeeded, resetSeedGuard } from './db';
import {
  addBodyweight,
  archiveExercise,
  exportAll,
  finishSession,
  getActiveSession,
  getExerciseHistory,
  getLastCompletedSession,
  getLastSessionSetsForExercise,
  getSessionDetail,
  getSettings,
  importMerge,
  readSettings,
  listBodyweight,
  listExercises,
  listTemplates,
  logSet,
  reorderExercises,
  startSession,
  updateSettings,
  upsertExercise,
  wipeAll,
} from './repo';

beforeEach(async () => {
  resetSeedGuard();
  await wipeAll();
  await ensureSeeded();
});

describe('seed', () => {
  it('creates four templates in rotation order', async () => {
    const templates = await listTemplates();
    expect(templates.map((t) => t.id)).toEqual(['lowerA', 'upperA', 'lowerB', 'upperB']);
  });

  it('creates the full programme', async () => {
    const all = await listExercises();
    expect(all).toHaveLength(28);
    for (const id of ['lowerA', 'upperA', 'lowerB', 'upperB'] as const) {
      const rows = await listExercises(id);
      expect(rows).toHaveLength(7);
      expect(rows.map((r) => r.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    }
  });

  it('maps units and increments per the spec', async () => {
    const byName = new Map((await listExercises()).map((e) => [`${e.templateId}:${e.name}`, e]));
    expect(byName.get('lowerA:Hack squat (feet ahead, wide)')).toMatchObject({
      unit: 'kg_total',
      increment: 5,
      type: 'primary',
      repMin: 8,
      repMax: 10,
      sets: 4,
    });
    expect(byName.get('upperA:DB incline bench')).toMatchObject({ unit: 'kg_side', increment: 2.5 });
    expect(byName.get('upperA:DB laterals')).toMatchObject({ unit: 'kg_side', increment: 1 });
    expect(byName.get('upperA:Half side plank')).toMatchObject({
      measure: 'seconds',
      repMin: 45,
      repMax: 45,
      perSide: true,
    });
    expect(byName.get('lowerA:Seated abduction (band)')).toMatchObject({ unit: 'band', increment: 0 });
    expect(byName.get("upperB:Farmer's walk")).toMatchObject({
      measure: 'laps',
      sets: 3,
      repMin: 1,
      repMax: 1,
      unit: 'kg_side',
    });
    expect(byName.get('lowerB:Row 1 km')).toMatchObject({
      type: 'conditioning',
      measure: 'seconds',
      sets: 1,
      repMin: 0,
      repMax: 0,
      unit: 'none',
      increment: 0,
    });
  });

  it('creates default settings', async () => {
    expect(await getSettings()).toMatchObject({ restPrimary: 120, restAccessory: 90, units: 'kg' });
    expect(await updateSettings({ restPrimary: 150 })).toMatchObject({ restPrimary: 150 });
    expect((await getSettings()).restPrimary).toBe(150);
  });
});

describe('settings defaults', () => {
  it('fills fields a row written by an older version never had', async () => {
    // A pre-keepAwake row, exactly as an old build would have left it.
    await db.settings.put({
      id: 'settings',
      restPrimary: 100,
      restAccessory: 80,
      units: 'kg',
    } as never);

    const settings = await getSettings();
    expect(settings.restPrimary).toBe(100);
    expect(settings.keepAwake).toBe(true);
    expect(await readSettings()).toMatchObject({ restAccessory: 80, keepAwake: true });

    // Writing anything back persists the filled-in defaults too.
    await updateSettings({ restPrimary: 110 });
    expect(await db.settings.get('settings')).toMatchObject({
      restPrimary: 110,
      keepAwake: true,
    });
  });
});

describe('exercises', () => {
  it('appends new exercises and hides archived ones', async () => {
    const created = await upsertExercise({
      templateId: 'lowerA',
      name: 'Sissy squat',
      sets: 3,
      repMin: 12,
      repMax: 15,
      measure: 'reps',
      perSide: false,
      unit: 'bodyweight',
      increment: 0,
      type: 'accessory',
    });
    expect(created.order).toBe(7);
    expect(await listExercises('lowerA')).toHaveLength(8);

    await archiveExercise(created.id);
    expect(await listExercises('lowerA')).toHaveLength(7);
    expect(await listExercises('lowerA', true)).toHaveLength(8);
  });

  it('reorders by id list', async () => {
    const before = await listExercises('lowerA');
    const reversed = [...before].reverse().map((e) => e.id);
    await reorderExercises('lowerA', reversed);
    const after = await listExercises('lowerA');
    expect(after.map((e) => e.id)).toEqual(reversed);
  });
});

describe('sessions and sets', () => {
  it('tracks the active session and finishes it', async () => {
    const session = await startSession('lowerA');
    expect((await getActiveSession())?.id).toBe(session.id);
    await finishSession(session.id, 'felt good');
    expect(await getActiveSession()).toBeUndefined();
    const detail = await getSessionDetail(session.id);
    expect(detail?.session.notes).toBe('felt good');
    expect(detail?.session.finishedAt).toBeTypeOf('number');
    expect(detail?.exercises).toHaveLength(7);
    expect((await getLastCompletedSession())?.id).toBe(session.id);
  });

  it('upserts a set on the same (session, exercise, setIndex)', async () => {
    const session = await startSession('lowerA');
    const first = await logSet({
      sessionId: session.id,
      exerciseId: 'ex_hack_squat',
      setIndex: 0,
      load: 70,
      reps: 10,
    });
    const second = await logSet({
      sessionId: session.id,
      exerciseId: 'ex_hack_squat',
      setIndex: 0,
      load: 72.5,
      reps: 9,
    });
    expect(second.id).toBe(first.id);
    const detail = await getSessionDetail(session.id);
    expect(detail?.setsByExercise.ex_hack_squat).toHaveLength(1);
    expect(detail?.setsByExercise.ex_hack_squat?.[0]?.load).toBe(72.5);
  });

  it('returns the previous session sets, excluding the current one', async () => {
    const older = await startSession('lowerA', 1_000);
    for (let i = 0; i < 4; i++) {
      await logSet({ sessionId: older.id, exerciseId: 'ex_hack_squat', setIndex: i, load: 70, reps: 10 });
    }
    await finishSession(older.id);

    const current = await startSession('lowerA', 2_000);
    await logSet({ sessionId: current.id, exerciseId: 'ex_hack_squat', setIndex: 0, load: 75, reps: 8 });

    const last = await getLastSessionSetsForExercise('ex_hack_squat', current.id);
    expect(last).toHaveLength(4);
    expect(last?.every((s) => s.sessionId === older.id)).toBe(true);

    const history = await getExerciseHistory('ex_hack_squat');
    expect(history.map((h) => h.session.id)).toEqual([older.id, current.id]);
    expect(await getLastSessionSetsForExercise('ex_never_logged')).toBeUndefined();
  });
});

describe('exercise snapshots', () => {
  it('freezes the template exercises into the session when it starts', async () => {
    const session = await startSession('lowerA');
    const live = await listExercises('lowerA');

    expect(session.exercises?.map((e) => e.id)).toEqual(live.map((e) => e.id));
    expect(session.exercises?.[0]).toEqual({
      id: live[0]!.id,
      name: live[0]!.name,
      sets: live[0]!.sets,
      repMin: live[0]!.repMin,
      repMax: live[0]!.repMax,
      measure: live[0]!.measure,
      perSide: live[0]!.perSide,
      unit: live[0]!.unit,
      type: live[0]!.type,
    });
    // Snapshots carry the prescription only, never the progression increment.
    expect(session.exercises?.[0]).not.toHaveProperty('increment');
  });

  it('leaves archived exercises out of the snapshot', async () => {
    const [first] = await listExercises('lowerA');
    await archiveExercise(first!.id);
    const session = await startSession('lowerA');
    expect(session.exercises?.some((e) => e.id === first!.id)).toBe(false);
  });

  it('getSessionDetail shows the name and order the session was logged with', async () => {
    const session = await startSession('lowerA');
    const original = await listExercises('lowerA');
    const target = original[2]!;
    await logSet({
      sessionId: session.id,
      exerciseId: target.id,
      setIndex: 0,
      load: 40,
      reps: 10,
    });

    // Rename it and move it to the front, the way a Programme edit would.
    await upsertExercise({ ...target, name: 'Lying leg curl' });
    await reorderExercises(
      'lowerA',
      [target.id, ...original.filter((e) => e.id !== target.id).map((e) => e.id)],
    );

    const detail = await getSessionDetail(session.id);
    expect(detail!.exercises.map((e) => e.id)).toEqual(original.map((e) => e.id));
    expect(detail!.exercises[2]!.name).toBe(target.name);
    // The live increment still comes through, so progression keeps working.
    expect(detail!.exercises[2]!.increment).toBe(target.increment);
    expect(detail!.setsByExercise[target.id]).toHaveLength(1);
  });

  it('keeps a logged exercise that is missing from the snapshot', async () => {
    const session = await startSession('lowerA');
    const upper = (await listExercises('upperA'))[0]!;
    await logSet({
      sessionId: session.id,
      exerciseId: upper.id,
      setIndex: 0,
      load: 20,
      reps: 8,
    });

    const detail = await getSessionDetail(session.id);
    expect(detail!.exercises.map((e) => e.id)).toContain(upper.id);
  });

  it('falls back to the live template for a session with no snapshot', async () => {
    const session = await startSession('lowerA');
    await db.sessions.update(session.id, { exercises: undefined });
    const detail = await getSessionDetail(session.id);
    expect(detail!.exercises.map((e) => e.id)).toEqual(
      (await listExercises('lowerA')).map((e) => e.id),
    );
  });
});

describe('bodyweight', () => {
  it('keeps one entry per day', async () => {
    await addBodyweight('2024-05-01', 80);
    await addBodyweight('2024-05-02', 79.6);
    await addBodyweight('2024-05-01', 79.9);
    const rows = await listBodyweight();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: '2024-05-01', kg: 79.9 });
  });
});

describe('export / import', () => {
  it('round-trips without overwriting existing rows', async () => {
    const session = await startSession('lowerA');
    await logSet({ sessionId: session.id, exerciseId: 'ex_hack_squat', setIndex: 0, load: 70, reps: 10 });
    await finishSession(session.id);
    await addBodyweight('2024-05-01', 80);

    const bundle = await exportAll();
    expect(bundle.version).toBe(1);
    expect(bundle.exercises).toHaveLength(28);

    // Re-importing the same bundle is a no-op.
    const again = await importMerge(JSON.parse(JSON.stringify(bundle)));
    expect(again).toMatchObject({ exercises: 0, sessions: 0, setLogs: 0, bodyweight: 0 });
    expect(await listExercises()).toHaveLength(28);

    // A foreign session merges in; an existing row is left alone.
    const foreign = {
      ...bundle,
      sessions: [{ id: 'foreign-1', templateId: 'upperA', startedAt: 5, finishedAt: 6 }],
      setLogs: [
        { id: 'fs-1', sessionId: 'foreign-1', exerciseId: 'ex_seated_row', setIndex: 0, load: 50, reps: 12 },
        { id: 'fs-bad', sessionId: 'foreign-1' },
      ],
      bodyweight: [{ id: 'bw-x', date: '2024-06-01', kg: 78 }],
    };
    const counts = await importMerge(foreign);
    expect(counts).toMatchObject({ sessions: 1, setLogs: 1, bodyweight: 1, skipped: 1 });
    expect(await db.sessions.count()).toBe(2);

    await expect(importMerge('nope')).rejects.toThrow();
  });

  it('imports sessions with and without an exercise snapshot', async () => {
    const counts = await importMerge({
      version: 1,
      exportedAt: Date.now(),
      sessions: [
        { id: 'old', templateId: 'lowerA', startedAt: 1 },
        {
          id: 'new',
          templateId: 'lowerA',
          startedAt: 2,
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
        { id: 'bad', templateId: 'lowerA', startedAt: 3, exercises: 'nope' },
      ],
    });

    expect(counts.sessions).toBe(2);
    expect(counts.skipped).toBe(1);
    expect((await getSessionDetail('old'))!.exercises.length).toBeGreaterThan(1);
    expect((await getSessionDetail('new'))!.exercises.map((e) => e.name)).toEqual(['Leg press']);
  });

  it('wipeAll clears logs and restores the programme', async () => {
    const session = await startSession('lowerA');
    await logSet({ sessionId: session.id, exerciseId: 'ex_hack_squat', setIndex: 0, load: 70, reps: 10 });
    await wipeAll();
    expect(await db.sessions.count()).toBe(0);
    expect(await db.setLogs.count()).toBe(0);
    expect(await listExercises()).toHaveLength(28);
    expect(await getSettings()).toMatchObject({ restPrimary: 120 });
  });
});
