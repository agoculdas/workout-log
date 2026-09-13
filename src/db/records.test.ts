import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, ensureSeeded, resetSeedGuard } from './db';
import {
  createProgramme,
  createTemplate,
  finishSession,
  getAllRecords,
  getExerciseRecords,
  getSessionRecords,
  getSessionSummary,
  logSet,
  startSession,
  upsertExercise,
  wipeAll,
} from './repo';

beforeEach(async () => {
  resetSeedGuard();
  await wipeAll();
  await ensureSeeded();
});

const HACK = 'ex_hack_squat';
const ROW = 'ex_row_1km_b';

/** One completed Lower A session: `[load, reps]` pairs, warm-ups flagged. */
async function loggedSession(
  sets: Array<{ load: number; reps: number; warmup?: boolean; exerciseId?: string }>,
  startedAt?: number,
): Promise<string> {
  const session = await startSession('lowerA', startedAt);
  let working = 0;
  let warm = -1;
  for (const set of sets) {
    await logSet({
      sessionId: session.id,
      exerciseId: set.exerciseId ?? HACK,
      setIndex: set.warmup ? warm-- : working++,
      load: set.load,
      reps: set.reps,
      ...(set.warmup ? { kind: 'warmup' as const } : {}),
    });
  }
  await finishSession(session.id);
  return session.id;
}

describe('getExerciseRecords', () => {
  it('is empty for an exercise that has never been logged', async () => {
    expect(await getExerciseRecords(HACK)).toEqual({});
  });

  it('is empty for an exercise that does not exist', async () => {
    expect(await getExerciseRecords('nope')).toEqual({});
  });

  it('reads the best set and session out of completed sessions', async () => {
    const first = await loggedSession([
      { load: 100, reps: 8 },
      { load: 100, reps: 8 },
      { load: 100, reps: 8 },
    ]);
    await loggedSession([
      { load: 105, reps: 8 },
      { load: 105, reps: 6 },
    ]);

    const records = await getExerciseRecords(HACK);
    expect(records.heaviest).toMatchObject({ value: 105, reps: 8 });
    expect(records.bestVolume).toMatchObject({ value: 2400, sessionId: first });
  });

  it('ignores warm-ups however heavy they are', async () => {
    await loggedSession([
      { load: 200, reps: 5, warmup: true },
      { load: 100, reps: 8 },
    ]);
    const records = await getExerciseRecords(HACK);
    expect(records.heaviest).toMatchObject({ value: 100, reps: 8 });
  });

  it('ignores a session that was never finished', async () => {
    const open = await startSession('lowerA');
    await logSet({ sessionId: open.id, exerciseId: HACK, setIndex: 0, load: 200, reps: 5 });
    expect(await getExerciseRecords(HACK)).toEqual({});
  });

  it('leaves out the session you are in when asked to', async () => {
    await loggedSession([{ load: 100, reps: 8 }], 1_000);
    const second = await loggedSession([{ load: 120, reps: 8 }], 2_000);

    expect((await getExerciseRecords(HACK)).heaviest?.value).toBe(120);
    expect(
      (await getExerciseRecords(HACK, { excludeSessionId: second })).heaviest?.value,
    ).toBe(100);
  });

  it('compares the history in the denomination the exercise is in now', async () => {
    await loggedSession([{ load: 100, reps: 5 }], 1_000); // stamped kg
    await db.exercises.update(HACK, { massUnit: 'lb', increment: 5 });
    await loggedSession([{ load: 200, reps: 5 }], 2_000); // stamped lb

    const records = await getExerciseRecords(HACK);
    // 100 kg is 220.5 lb, so the older session still holds it.
    expect(records.heaviest?.value).toBeCloseTo(220.462, 3);
    expect(records.heaviest?.reps).toBe(5);
  });

  it('takes the lowest time for conditioning', async () => {
    const slow = await startSession('lowerB', 1_000);
    await logSet({ sessionId: slow.id, exerciseId: ROW, setIndex: 0, load: 0, reps: 260 });
    await finishSession(slow.id);

    const fast = await startSession('lowerB', 2_000);
    await logSet({ sessionId: fast.id, exerciseId: ROW, setIndex: 0, load: 0, reps: 245 });
    await finishSession(fast.id);

    const records = await getExerciseRecords(ROW);
    expect(records.bestTime).toMatchObject({ value: 245, sessionId: fast.id });
    expect(records.heaviest).toBeUndefined();
  });
});

describe('getSessionRecords', () => {
  it('claims nothing on the first session of an exercise', async () => {
    const first = await loggedSession([
      { load: 100, reps: 8 },
      { load: 100, reps: 8 },
    ]);
    expect(await getSessionRecords(first)).toEqual([]);
  });

  it('reports what the second session beat', async () => {
    await loggedSession([{ load: 100, reps: 8 }], 1_000);
    const second = await loggedSession([{ load: 110, reps: 8 }], 2_000);

    const rows = await getSessionRecords(second);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ exerciseId: HACK, name: 'Hack squat (feet ahead, wide)' });
    expect(rows[0]?.kinds).toEqual(['e1rm', 'heaviest', 'bestVolume']);
    expect(rows[0]?.entries.heaviest).toMatchObject({ value: 110, sessionId: second });
  });

  it('says nothing when the session only matched the record', async () => {
    await loggedSession([{ load: 100, reps: 8 }], 1_000);
    const second = await loggedSession([{ load: 100, reps: 8 }], 2_000);
    expect(await getSessionRecords(second)).toEqual([]);
  });

  it('does not let a warm-up set a record', async () => {
    await loggedSession([{ load: 100, reps: 8 }], 1_000);
    const second = await loggedSession(
      [
        { load: 200, reps: 5, warmup: true },
        { load: 95, reps: 8 },
      ],
      2_000,
    );
    expect(await getSessionRecords(second)).toEqual([]);
  });

  it('reports a faster time on a conditioning day', async () => {
    const slow = await startSession('lowerB', 1_000);
    await logSet({ sessionId: slow.id, exerciseId: ROW, setIndex: 0, load: 0, reps: 260 });
    await finishSession(slow.id);

    const fast = await startSession('lowerB', 2_000);
    await logSet({ sessionId: fast.id, exerciseId: ROW, setIndex: 0, load: 0, reps: 245 });
    await finishSession(fast.id);

    const rows = await getSessionRecords(fast.id);
    expect(rows.map((r) => r.exerciseId)).toEqual([ROW]);
    expect(rows[0]?.kinds).toEqual(['bestTime']);
    expect(rows[0]?.entries.bestTime).toMatchObject({ value: 245 });
  });

  it('is empty for a session that no longer exists', async () => {
    expect(await getSessionRecords('gone')).toEqual([]);
  });
});

describe('getSessionSummary', () => {
  it('carries the session records, so the finish sheet needs one call', async () => {
    await loggedSession([{ load: 100, reps: 8 }], 1_000);
    const second = await loggedSession([{ load: 110, reps: 8 }], 2_000);

    const summary = await getSessionSummary(second);
    expect(summary?.records.map((r) => r.exerciseId)).toEqual([HACK]);
    expect(summary?.records[0]?.kinds).toContain('heaviest');
  });

  it('carries an empty list when nothing was beaten', async () => {
    const first = await loggedSession([{ load: 100, reps: 8 }]);
    expect((await getSessionSummary(first))?.records).toEqual([]);
  });
});

describe('getAllRecords', () => {
  it('is empty until something is logged', async () => {
    expect(await getAllRecords()).toEqual([]);
  });

  it('lists only exercises that hold a record, with their day', async () => {
    await loggedSession([{ load: 100, reps: 8 }]);
    const rows = await getAllRecords();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      templateName: 'Lower A',
      programmeName: 'Upper / Lower',
      activeProgramme: true,
    });
    expect(rows[0]?.exercise.id).toBe(HACK);
    expect(rows[0]?.records.heaviest?.value).toBe(100);
  });

  it('keeps the active programme first and its days in rotation order', async () => {
    // Lower B sits after Upper A in the seeded rotation, so a Lower B record
    // must come after an Upper A one however the day rows are ordered.
    await loggedSession([{ load: 100, reps: 8 }]);

    const upper = await startSession('upperA');
    await logSet({
      sessionId: upper.id,
      exerciseId: 'ex_db_incline_bench',
      setIndex: 0,
      load: 30,
      reps: 8,
    });
    await finishSession(upper.id);

    const other = await createProgramme('PPL');
    const day = await createTemplate(other.id, { name: 'Push', tags: ['push'] });
    const pressing = await upsertExercise({
      templateId: day.id,
      name: 'Overhead press',
      sets: 3,
      repMin: 5,
      repMax: 8,
      measure: 'reps',
      perSide: false,
      unit: 'kg_total',
      increment: 2.5,
      type: 'primary',
    });
    const pushDay = await startSession(day.id);
    await logSet({
      sessionId: pushDay.id,
      exerciseId: pressing.id,
      setIndex: 0,
      load: 50,
      reps: 5,
    });
    await finishSession(pushDay.id);

    const rows = await getAllRecords();
    expect(rows.map((r) => r.templateName)).toEqual(['Lower A', 'Upper A', 'Push']);
    expect(rows.map((r) => r.activeProgramme)).toEqual([true, true, false]);
    expect(rows[2]?.programmeName).toBe('PPL');
  });

  it('leaves out archived exercises', async () => {
    await loggedSession([{ load: 100, reps: 8 }]);
    await db.exercises.update(HACK, { archived: true });
    expect(await getAllRecords()).toEqual([]);
  });
});
