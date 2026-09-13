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
  markExported,
  getSessionSummary,
  updateSession,
  updateSet,
  listSetsForSessionExercise,
  reorderExercises,
  setExerciseOverride,
  startSession,
  updateSettings,
  upsertExercise,
  wipeAll,
} from './repo';
import type { Exercise } from './types';

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
    // Fields added after that row was written come from DEFAULT_SETTINGS.
    expect(settings.barWeight).toBe(20);
    expect(settings.plates).toEqual([25, 20, 15, 10, 5, 2.5, 1.25]);
    expect(settings.setsPerMuscleTarget).toEqual({ min: 10, max: 20 });
    expect(settings.lastExportAt).toBeUndefined();
    expect(await readSettings()).toMatchObject({
      restAccessory: 80,
      keepAwake: true,
      barWeight: 20,
      setsPerMuscleTarget: { min: 10, max: 20 },
    });

    // The filled-in containers are copies — mutating one cannot poison the next read.
    settings.plates.push(0.5);
    settings.setsPerMuscleTarget.min = 99;
    expect((await getSettings()).plates).toEqual([25, 20, 15, 10, 5, 2.5, 1.25]);
    expect((await getSettings()).setsPerMuscleTarget).toEqual({ min: 10, max: 20 });

    // Writing anything back persists the filled-in defaults too.
    await updateSettings({ restPrimary: 110 });
    expect(await db.settings.get('settings')).toMatchObject({
      restPrimary: 110,
      keepAwake: true,
      barWeight: 20,
      plates: [25, 20, 15, 10, 5, 2.5, 1.25],
    });
  });

  it('keeps an explicit plate list and band', async () => {
    await updateSettings({
      barWeight: 15,
      plates: [20, 10, 5],
      setsPerMuscleTarget: { min: 8, max: 16 },
    });
    expect(await getSettings()).toMatchObject({
      barWeight: 15,
      plates: [20, 10, 5],
      setsPerMuscleTarget: { min: 8, max: 16 },
    });
  });
});

describe('markExported', () => {
  it('stamps the backup time, and exportAll does not', async () => {
    expect((await getSettings()).lastExportAt).toBeUndefined();

    await exportAll();
    expect((await getSettings()).lastExportAt).toBeUndefined();

    const before = Date.now();
    await markExported();
    const stamped = (await getSettings()).lastExportAt!;
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(Date.now());
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
      massUnit: 'kg',
      type: live[0]!.type,
      catalogId: live[0]!.catalogId,
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

describe('logSet — kind, toFailure and denomination', () => {
  it('stamps the exercise denomination when none is given', async () => {
    const session = await startSession('lowerA');
    const kg = await logSet({
      sessionId: session.id,
      exerciseId: 'ex_hack_squat',
      setIndex: 0,
      load: 80,
      reps: 10,
    });
    // Seeded rows carry no massUnit at all, so they read as kilograms.
    expect(kg.massUnit).toBe('kg');

    const pounds = await upsertExercise({
      templateId: 'lowerA',
      name: 'Pin press (lb stack)',
      sets: 3,
      repMin: 10,
      repMax: 10,
      measure: 'reps',
      perSide: false,
      unit: 'kg_total',
      massUnit: 'lb',
      increment: 5,
      type: 'accessory',
    });
    const lb = await logSet({
      sessionId: session.id,
      exerciseId: pounds.id,
      setIndex: 0,
      load: 100,
      reps: 10,
    });
    expect(lb.massUnit).toBe('lb');

    // An explicit denomination wins, and an unknown exercise falls back to kg.
    const forced = await logSet({
      sessionId: session.id,
      exerciseId: pounds.id,
      setIndex: 1,
      load: 45,
      reps: 10,
      massUnit: 'kg',
    });
    expect(forced.massUnit).toBe('kg');
    const orphan = await logSet({
      sessionId: session.id,
      exerciseId: 'ex_does_not_exist',
      setIndex: 0,
      load: 10,
      reps: 10,
    });
    expect(orphan.massUnit).toBe('kg');
  });

  it('records warm-ups and set facts, and updateSet can flip them', async () => {
    const session = await startSession('lowerA');
    const warm = await logSet({
      sessionId: session.id,
      exerciseId: 'ex_hack_squat',
      setIndex: 0,
      load: 40,
      reps: 10,
      kind: 'warmup',
    });
    const working = await logSet({
      sessionId: session.id,
      exerciseId: 'ex_hack_squat',
      setIndex: 1,
      load: 80,
      reps: 10,
      toFailure: true,
    });
    expect(warm.kind).toBe('warmup');
    expect(warm).not.toHaveProperty('toFailure');
    expect(working.kind).toBeUndefined();
    expect(working.toFailure).toBe(true);

    await updateSet(warm.id, { kind: undefined });
    await updateSet(working.id, { toFailure: false });
    const rows = await listSetsForSessionExercise(session.id, 'ex_hack_squat');
    expect(rows[0]!.kind).toBeUndefined();
    expect(rows[1]!.toFailure).toBe(false);
  });
});

describe('getSessionSummary', () => {
  /** A finished Lower A at 80 kg, so the next one has something to beat. */
  async function previousSession() {
    const first = await startSession('lowerA', 1_000);
    await logSet({ sessionId: first.id, exerciseId: 'ex_hack_squat', setIndex: 0, load: 80, reps: 10, completedAt: 1_100 });
    await logSet({ sessionId: first.id, exerciseId: 'ex_leg_curl_a', setIndex: 0, load: 40, reps: 10, completedAt: 1_200 });
    await finishSession(first.id);
    await updateSession(first.id, { finishedAt: 2_000 });
    return first;
  }

  it('reports duration, sets, warm-ups, volume and what progressed', async () => {
    await previousSession();

    const session = await startSession('lowerA', 10_000);
    await logSet({ sessionId: session.id, exerciseId: 'ex_hack_squat', setIndex: 0, load: 40, reps: 10, completedAt: 10_100, kind: 'warmup' });
    await logSet({ sessionId: session.id, exerciseId: 'ex_hack_squat', setIndex: 1, load: 85, reps: 10, completedAt: 10_200, toFailure: true });
    await logSet({ sessionId: session.id, exerciseId: 'ex_leg_curl_a', setIndex: 0, load: 40, reps: 10, completedAt: 10_300 });
    await finishSession(session.id);
    await updateSession(session.id, { finishedAt: 12_000 });

    const summary = (await getSessionSummary(session.id))!;
    expect(summary.templateName).toBe('Lower A');
    expect(summary.durationMs).toBe(2_000);
    expect(summary.setsLogged).toBe(2);
    expect(summary.warmups).toBe(1);
    expect(summary.volumeKg).toBe(85 * 10 + 40 * 10);

    // Only the exercises that were actually logged.
    expect(summary.exercises.map((e) => e.exerciseId)).toEqual([
      'ex_hack_squat',
      'ex_leg_curl_a',
    ]);

    const squat = summary.exercises[0]!;
    expect(squat).toMatchObject({
      name: 'Hack squat (feet ahead, wide)',
      summary: '1×10 @ 85 kg',
      toFailure: 1,
      progressed: true,
      previousTop: 80,
      top: 85,
      massUnit: 'kg',
    });

    const curl = summary.exercises[1]!;
    expect(curl).toMatchObject({ progressed: false, previousTop: 40, top: 40, toFailure: 0 });
  });

  it('claims nothing without a previous completed session', async () => {
    const session = await startSession('lowerA', 1_000);
    await logSet({ sessionId: session.id, exerciseId: 'ex_hack_squat', setIndex: 0, load: 80, reps: 10, completedAt: 1_100 });

    const summary = (await getSessionSummary(session.id))!;
    const squat = summary.exercises[0]!;
    expect(squat.progressed).toBe(false);
    expect(squat.previousTop).toBeUndefined();
    expect(squat.top).toBe(80);
    // Still running: the duration counts up from the start.
    expect(summary.durationMs).toBeGreaterThan(0);

    // An unfinished earlier session is not something to beat either.
    const open = await startSession('lowerA', 5_000);
    await logSet({ sessionId: open.id, exerciseId: 'ex_hack_squat', setIndex: 0, load: 90, reps: 10, completedAt: 5_100 });
    const later = await startSession('lowerA', 9_000);
    await logSet({ sessionId: later.id, exerciseId: 'ex_hack_squat', setIndex: 0, load: 85, reps: 10, completedAt: 9_100 });
    expect((await getSessionSummary(later.id))!.exercises[0]!.progressed).toBe(false);
  });

  it('totals mixed denominations in kilograms', async () => {
    const pounds = await upsertExercise({
      templateId: 'lowerA',
      name: 'Pin press (lb stack)',
      sets: 3,
      repMin: 10,
      repMax: 10,
      measure: 'reps',
      perSide: false,
      unit: 'kg_total',
      massUnit: 'lb',
      increment: 5,
      type: 'accessory',
    });
    const session = await startSession('lowerA', 1_000);
    await logSet({ sessionId: session.id, exerciseId: 'ex_hack_squat', setIndex: 0, load: 100, reps: 10, completedAt: 1_100 });
    await logSet({ sessionId: session.id, exerciseId: pounds.id, setIndex: 0, load: 100, reps: 10, completedAt: 1_200 });

    const summary = (await getSessionSummary(session.id))!;
    expect(summary.volumeKg).toBeCloseTo(1_000 + 453.59237, 5);
    const lb = summary.exercises.find((e) => e.exerciseId === pounds.id)!;
    expect(lb.massUnit).toBe('lb');
    expect(lb.summary).toBe('1×10 @ 100 lb');
  });

  it('returns undefined for a session that is not there', async () => {
    expect(await getSessionSummary('nope')).toBeUndefined();
  });
});

describe('import tolerance for the new optional fields', () => {
  const foreignSettings = {
    id: 'settings',
    restPrimary: 111,
    restAccessory: 77,
    units: 'lb',
    keepAwake: false,
    lastExportAt: 1234,
    barWeight: 15,
    plates: [20, 10],
    setsPerMuscleTarget: { min: 8, max: 16 },
  };

  it('merges warm-ups, set facts and denominations', async () => {
    const counts = await importMerge({
      version: 1,
      exportedAt: Date.now(),
      exercises: [
        {
          id: 'ex_foreign',
          templateId: 'lowerA',
          name: 'Foreign press',
          sets: 3,
          repMin: 10,
          repMax: 10,
          measure: 'reps',
          perSide: false,
          unit: 'kg_total',
          massUnit: 'lb',
          increment: 5,
          type: 'accessory',
          order: 99,
          scheme: 'linear',
          restOverride: 45,
          note: 'Seat 4, handles narrow',
          override: { load: 85, reps: 8, kind: 'deload', setAt: 5 },
        },
      ],
      sessions: [{ id: 'foreign-1', templateId: 'lowerA', startedAt: 1, finishedAt: 2 }],
      setLogs: [
        { id: 'fs-warm', sessionId: 'foreign-1', exerciseId: 'ex_foreign', setIndex: 0, load: 45, reps: 10, completedAt: 1, kind: 'warmup', massUnit: 'lb' },
        { id: 'fs-work', sessionId: 'foreign-1', exerciseId: 'ex_foreign', setIndex: 1, load: 95, reps: 10, completedAt: 2, toFailure: true, massUnit: 'lb' },
      ],
      settings: [foreignSettings],
    });

    expect(counts).toMatchObject({ exercises: 1, sessions: 1, setLogs: 2, skipped: 0 });
    expect(await db.exercises.get('ex_foreign')).toMatchObject({
      massUnit: 'lb',
      scheme: 'linear',
      restOverride: 45,
      note: 'Seat 4, handles narrow',
      override: { load: 85, kind: 'deload' },
    });
    expect(await db.setLogs.get('fs-warm')).toMatchObject({ kind: 'warmup', massUnit: 'lb' });
    expect(await db.setLogs.get('fs-work')).toMatchObject({ toFailure: true, massUnit: 'lb' });

    // The local settings row already exists, so the foreign one is not applied.
    expect((await getSettings()).restPrimary).toBe(120);

    const summary = (await getSessionSummary('foreign-1'))!;
    expect(summary.setsLogged).toBe(1);
    expect(summary.warmups).toBe(1);
    expect(summary.volumeKg).toBeCloseTo(95 * 10 * 0.45359237, 5);
  });

  it('takes a settings row carrying the new fields when there is none', async () => {
    await db.settings.clear();
    const counts = await importMerge({
      version: 1,
      exportedAt: Date.now(),
      settings: [foreignSettings],
    });
    expect(counts.settings).toBe(1);
    expect(await getSettings()).toMatchObject({
      units: 'lb',
      lastExportAt: 1234,
      barWeight: 15,
      plates: [20, 10],
      setsPerMuscleTarget: { min: 8, max: 16 },
    });
  });
});

describe('progression schemes, stall overrides, rest and notes', () => {
  /** The first exercise of Lower A, with whatever patch the test needs. */
  async function firstOf(templateId: string, patch: Partial<Exercise> = {}) {
    const row = (await listExercises(templateId))[0]!;
    return Object.keys(patch).length ? await upsertExercise({ ...row, ...patch }) : row;
  }

  it('stores a scheme, a rest override and a note on an exercise', async () => {
    const row = await firstOf('lowerA', {
      scheme: 'linear',
      restOverride: 45,
      note: 'Seat 4, handles narrow',
    });
    expect(await db.exercises.get(row.id)).toMatchObject({
      scheme: 'linear',
      restOverride: 45,
      note: 'Seat 4, handles narrow',
    });
  });

  it('setExerciseOverride writes the answer and clears it again', async () => {
    const row = await firstOf('lowerA');
    await setExerciseOverride(row.id, { load: 90, reps: 8, kind: 'deload', setAt: 1 });
    expect((await db.exercises.get(row.id))?.override).toMatchObject({
      load: 90,
      kind: 'deload',
    });

    await setExerciseOverride(row.id, undefined);
    expect((await db.exercises.get(row.id))?.override).toBeUndefined();
  });

  it('finishSession clears the override only where a working set was logged', async () => {
    const [first, second, third] = await listExercises('lowerA');
    const override = { load: 90, reps: 8, kind: 'deload' as const, setAt: 1 };
    for (const row of [first!, second!, third!]) await setExerciseOverride(row.id, override);

    const session = await startSession('lowerA');
    await logSet({
      sessionId: session.id,
      exerciseId: first!.id,
      setIndex: 0,
      load: 90,
      reps: 8,
    });
    // A warm-up is not an answer to a stall, so it must not clear anything.
    await logSet({
      sessionId: session.id,
      exerciseId: second!.id,
      setIndex: -1,
      load: 40,
      reps: 10,
      kind: 'warmup',
    });
    await finishSession(session.id);

    expect((await db.exercises.get(first!.id))?.override).toBeUndefined();
    expect((await db.exercises.get(second!.id))?.override).toMatchObject({ load: 90 });
    expect((await db.exercises.get(third!.id))?.override).toMatchObject({ load: 90 });
  });

  it('freezes the scheme, rest and note into the session snapshot', async () => {
    const row = await firstOf('lowerA', {
      scheme: 'linear',
      restOverride: 45,
      note: 'Seat 4',
    });
    const session = await startSession('lowerA');
    const snapshot = session.exercises?.find((e) => e.id === row.id);
    expect(snapshot).toMatchObject({ scheme: 'linear', restOverride: 45, note: 'Seat 4' });

    // Changing the programme afterwards must not rewrite the session.
    await upsertExercise({ ...row, scheme: 'none', note: 'Seat 2' });
    const detail = await getSessionDetail(session.id);
    expect(detail!.exercises.find((e) => e.id === row.id)).toMatchObject({
      scheme: 'linear',
      note: 'Seat 4',
    });
  });

  it('leaves the snapshot clean when there is nothing to freeze', async () => {
    const session = await startSession('lowerA');
    const snapshot = session.exercises![0]!;
    expect(snapshot).not.toHaveProperty('scheme');
    expect(snapshot).not.toHaveProperty('restOverride');
    expect(snapshot).not.toHaveProperty('note');
    // The stall override is live state, never frozen.
    expect(snapshot).not.toHaveProperty('override');
  });

  it('reads the override from the live row, so it can be chosen mid-session', async () => {
    const row = await firstOf('lowerA');
    const session = await startSession('lowerA');
    expect((await getSessionDetail(session.id))!.exercises[0]!.override).toBeUndefined();

    await setExerciseOverride(row.id, { load: 90, reps: 8, kind: 'bottom', setAt: 1 });
    expect((await getSessionDetail(session.id))!.exercises[0]!.override).toMatchObject({
      load: 90,
      kind: 'bottom',
    });
  });
});
