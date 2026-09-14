import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, ensureSeeded, resetSeedGuard } from './db';
import {
  addBodyweight,
  exportAll,
  finishSession,
  getExerciseHistory,
  getExerciseRecords,
  getMuscleVolume,
  getSessionDetail,
  getSessionPlan,
  getSessionRecords,
  getSessionSummary,
  getVolumeContext,
  importMerge,
  logSet,
  moveSessionExercise,
  listExercises,
  skipSessionExercise,
  startSession,
  swapSessionExercise,
  updateSessionPlan,
  updateSettings,
  wipeAll,
} from './repo';
import { totalVolumeKg } from '../logic/volume';

beforeEach(async () => {
  resetSeedGuard();
  await wipeAll();
  await ensureSeeded();
});

/** Lower A, whose seeded plan is seven exercises starting with the hack squat. */
async function startLowerA(startedAt = Date.now()) {
  return startSession('lowerA', { startedAt });
}

describe('the session plan', () => {
  it('snapshots the day in order, with nothing skipped', async () => {
    const session = await startLowerA();
    const plan = await getSessionPlan(session.id);
    expect(plan.map((e) => e.id)).toEqual([
      'ex_hack_squat',
      'ex_leg_press',
      'ex_leg_curl_a',
      'ex_uni_hip_thrust',
      'ex_seated_abduction',
      'ex_pallof_press',
      'ex_calf_raises_a',
    ]);
    expect(plan.every((e) => e.skipped === undefined)).toBe(true);
  });

  it('refuses a plan with the same exercise twice', async () => {
    const session = await startLowerA();
    const plan = await getSessionPlan(session.id);
    await expect(updateSessionPlan(session.id, [plan[0]!, plan[0]!])).rejects.toThrow(
      /Duplicate/,
    );
    await expect(updateSessionPlan('nope', plan)).rejects.toThrow(/Unknown session/);
  });

  it('builds a plan for a session recorded before snapshots existed', async () => {
    await db.sessions.put({ id: 'legacy', templateId: 'lowerA', startedAt: 1 });
    await skipSessionExercise('legacy', 'ex_leg_curl_a');
    const plan = await getSessionPlan('legacy');
    expect(plan).toHaveLength(7);
    expect(plan.find((e) => e.id === 'ex_leg_curl_a')?.skipped).toBe(true);
  });
});

describe('skipSessionExercise', () => {
  it('drops the exercise from the session and puts it back', async () => {
    const session = await startLowerA();
    await skipSessionExercise(session.id, 'ex_leg_curl_a');

    const detail = (await getSessionDetail(session.id))!;
    expect(detail.exercises.map((e) => e.id)).not.toContain('ex_leg_curl_a');
    expect(detail.exercises).toHaveLength(6);

    const all = (await getSessionDetail(session.id, { includeSkipped: true }))!;
    expect(all.exercises).toHaveLength(7);
    expect(all.exercises.find((e) => e.id === 'ex_leg_curl_a')?.skipped).toBe(true);

    await skipSessionExercise(session.id, 'ex_leg_curl_a', false);
    expect((await getSessionDetail(session.id))!.exercises).toHaveLength(7);
  });

  it('leaves the programme alone', async () => {
    const before = await listExercises('lowerA');
    const session = await startLowerA();
    await skipSessionExercise(session.id, 'ex_leg_curl_a');
    await moveSessionExercise(session.id, 'ex_leg_press', 'earlier');
    await swapSessionExercise(session.id, 'ex_calf_raises_a', 'cat_walking_lunge');
    const after = await listExercises('lowerA');
    expect(after.map((e) => e.id)).toEqual(before.map((e) => e.id));
    expect(after.map((e) => e.order)).toEqual(before.map((e) => e.order));
    expect(await db.exercises.count()).toBe(28);
  });

  it('keeps a skipped exercise out even when it already logged sets', async () => {
    const session = await startLowerA();
    await logSet({ sessionId: session.id, exerciseId: 'ex_leg_curl_a', setIndex: 0, load: 40, reps: 10 });
    await skipSessionExercise(session.id, 'ex_leg_curl_a');
    const detail = (await getSessionDetail(session.id))!;
    expect(detail.exercises.map((e) => e.id)).not.toContain('ex_leg_curl_a');
    // The sets themselves are never touched.
    expect(detail.setsByExercise['ex_leg_curl_a']).toHaveLength(1);
  });

  it('refuses an exercise that is not in the session', async () => {
    const session = await startLowerA();
    await expect(skipSessionExercise(session.id, 'ex_db_flat_bench')).rejects.toThrow(
      /not in this session/,
    );
  });
});

describe('moveSessionExercise', () => {
  it('moves one place at a time and stops at the ends', async () => {
    const session = await startLowerA();
    await moveSessionExercise(session.id, 'ex_leg_curl_a', 'earlier');
    expect((await getSessionPlan(session.id)).map((e) => e.id).slice(0, 3)).toEqual([
      'ex_hack_squat',
      'ex_leg_curl_a',
      'ex_leg_press',
    ]);

    await moveSessionExercise(session.id, 'ex_leg_curl_a', 'later');
    expect((await getSessionPlan(session.id)).map((e) => e.id).slice(0, 3)).toEqual([
      'ex_hack_squat',
      'ex_leg_press',
      'ex_leg_curl_a',
    ]);

    await moveSessionExercise(session.id, 'ex_hack_squat', 'earlier');
    expect((await getSessionPlan(session.id))[0]!.id).toBe('ex_hack_squat');
    await moveSessionExercise(session.id, 'ex_calf_raises_a', 'later');
    expect((await getSessionPlan(session.id))[6]!.id).toBe('ex_calf_raises_a');
  });

  it('reorders what the session screen pages through', async () => {
    const session = await startLowerA();
    await moveSessionExercise(session.id, 'ex_calf_raises_a', 'earlier');
    const detail = (await getSessionDetail(session.id))!;
    expect(detail.exercises.map((e) => e.id).slice(5)).toEqual([
      'ex_calf_raises_a',
      'ex_pallof_press',
    ]);
  });
});

describe('swapSessionExercise', () => {
  it('puts the replacement in the outgoing exercise place and skips the original', async () => {
    const session = await startLowerA();
    const replacement = await swapSessionExercise(
      session.id,
      'ex_leg_curl_a',
      'cat_walking_lunge',
    );

    expect(replacement.id.startsWith('tmp_')).toBe(true);
    expect(replacement.addedForToday).toBe(true);
    expect(replacement.catalogId).toBe('cat_walking_lunge');
    expect(replacement.name).toBe('Walking lunge');
    // Sets and rep target come from the outgoing row, the rest from the entry.
    expect(replacement).toMatchObject({ sets: 4, repMin: 10, repMax: 10, type: 'accessory' });

    const plan = await getSessionPlan(session.id);
    expect(plan.map((e) => e.id).slice(1, 4)).toEqual([
      'ex_leg_press',
      replacement.id,
      'ex_leg_curl_a',
    ]);
    expect(plan.find((e) => e.id === 'ex_leg_curl_a')?.skipped).toBe(true);

    const detail = (await getSessionDetail(session.id))!;
    expect(detail.exercises).toHaveLength(7);
    expect(detail.exercises[2]!.id).toBe(replacement.id);
    expect(detail.exercises[2]!.addedForToday).toBe(true);
  });

  it('takes the incoming measure default when the measure changes', async () => {
    const session = await startLowerA();
    const replacement = await swapSessionExercise(session.id, 'ex_leg_curl_a', 'cat_plank');
    expect(replacement.measure).toBe('seconds');
    expect(replacement.repMin).toBe(45);
    expect(replacement.repMax).toBe(45);
    expect(replacement.unit).toBe('bodyweight');
  });

  it('refuses an unknown entry or an exercise from another day', async () => {
    const session = await startLowerA();
    await expect(
      swapSessionExercise(session.id, 'ex_leg_curl_a', 'cat_nope'),
    ).rejects.toThrow(/Unknown catalogue entry/);
    await expect(
      swapSessionExercise(session.id, 'ex_db_flat_bench', 'cat_plank'),
    ).rejects.toThrow(/not in this session/);
  });
});

describe('a tmp_ exercise', () => {
  it('logs sets, and resolves everywhere through the snapshot', async () => {
    const session = await startLowerA();
    const swapped = await swapSessionExercise(
      session.id,
      'ex_leg_curl_a',
      'cat_walking_lunge',
    );

    const set = await logSet({
      sessionId: session.id,
      exerciseId: swapped.id,
      setIndex: 0,
      load: 20,
      reps: 10,
    });
    // The unit and denomination are stamped from the snapshot, not defaulted.
    expect(set.unit).toBe('kg_side');
    expect(set.massUnit).toBe('kg');

    const detail = (await getSessionDetail(session.id))!;
    expect(detail.setsByExercise[swapped.id]).toHaveLength(1);
    expect(detail.exercises.find((e) => e.id === swapped.id)?.name).toBe('Walking lunge');

    await finishSession(session.id);

    const summary = (await getSessionSummary(session.id))!;
    expect(summary.exercises.map((r) => r.name)).toEqual(['Walking lunge']);
    expect(summary.volumeKg).toBe(200);

    // Muscle volume resolves the catalogue entry off the snapshot.
    const muscles = await getMuscleVolume({ from: 0, to: Date.now() + 1000 });
    expect(muscles.unlinkedSets).toBe(0);
    expect(muscles.rows.find((r) => r.muscle === 'quads')?.sets).toBe(1);

    expect(await getExerciseHistory(swapped.id)).toHaveLength(1);
    // Records resolve the units off the snapshot rather than giving up on an
    // id that no `Exercise` row carries.
    expect((await getExerciseRecords(swapped.id)).heaviest).toMatchObject({
      value: 20,
      reps: 10,
    });
  });

  it('keeps its own records across two swaps of the same movement', async () => {
    const first = await startLowerA(Date.parse('2026-09-01T10:00:00'));
    const a = await swapSessionExercise(first.id, 'ex_leg_curl_a', 'cat_walking_lunge');
    await logSet({ sessionId: first.id, exerciseId: a.id, setIndex: 0, load: 20, reps: 10 });
    await finishSession(first.id);

    // A second swap is a different temporary exercise, so it starts fresh.
    const second = await startLowerA(Date.parse('2026-09-08T10:00:00'));
    const b = await swapSessionExercise(second.id, 'ex_leg_curl_a', 'cat_walking_lunge');
    expect(b.id).not.toBe(a.id);
    expect(await getExerciseRecords(b.id)).toEqual({});
    expect((await getExerciseRecords(a.id)).heaviest?.value).toBe(20);
  });
});

describe('bodyweight in volume', () => {
  /** The unilateral floor hip thrust is Lower A's `bodyweight` exercise. */
  const BODYWEIGHT_ID = 'ex_uni_hip_thrust';

  async function bodyweightSession(started: number): Promise<string> {
    const session = await startLowerA(started);
    await logSet({
      sessionId: session.id,
      exerciseId: BODYWEIGHT_ID,
      setIndex: 0,
      load: 0,
      reps: 10,
    });
    await finishSession(session.id);
    return session.id;
  }

  it('counts only the added load while the option is off', async () => {
    const id = await bodyweightSession(Date.now());
    expect((await getSessionSummary(id))!.volumeKg).toBe(0);
  });

  it('adds bodyweight x reps once the option is on and a weigh-in exists', async () => {
    const when = Date.parse('2026-09-12T18:00:00');
    await addBodyweight('2026-09-10', 82);
    await updateSettings({ countBodyweight: true });
    const id = await bodyweightSession(when);
    expect((await getSessionSummary(id))!.volumeKg).toBe(820);
  });

  it('never reads a later weigh-in backwards onto an older session', async () => {
    await updateSettings({ countBodyweight: true });
    const id = await bodyweightSession(Date.parse('2026-09-12T18:00:00'));
    await addBodyweight('2026-09-20', 82);
    expect((await getSessionSummary(id))!.volumeKg).toBe(0);
  });

  it('resolves the unit of sets logged before the stamp existed', async () => {
    await addBodyweight('2026-09-10', 80);
    await updateSettings({ countBodyweight: true });
    const session = await startLowerA(Date.parse('2026-09-12T18:00:00'));
    // A row written by an older version: no `unit`, no `massUnit`.
    await db.setLogs.put({
      id: 'old-set',
      sessionId: session.id,
      exerciseId: BODYWEIGHT_ID,
      setIndex: 0,
      load: 0,
      reps: 8,
      completedAt: Date.parse('2026-09-12T18:10:00'),
    });
    await finishSession(session.id);

    const context = await getVolumeContext();
    expect(context.countBodyweight).toBe(true);
    const sets = await db.setLogs.where('sessionId').equals(session.id).toArray();
    const stored = (await db.sessions.get(session.id))!;
    expect(totalVolumeKg(sets, context.optionsFor(stored))).toBe(640);
  });
});

describe('a skip after a set is already logged', () => {
  it('keeps the sets, and keeps them counted at the finish', async () => {
    const session = await startLowerA(Date.parse('2026-09-12T18:00:00'));
    await logSet({
      sessionId: session.id,
      exerciseId: 'ex_leg_curl_a',
      setIndex: 0,
      load: 40,
      reps: 10,
    });
    await skipSessionExercise(session.id, 'ex_leg_curl_a');
    await finishSession(session.id);

    const summary = (await getSessionSummary(session.id))!;
    // One line, and the totals beside it agree with it.
    expect(summary.exercises.map((r) => r.exerciseId)).toEqual(['ex_leg_curl_a']);
    expect(summary.setsLogged).toBe(1);
    expect(summary.volumeKg).toBe(400);
  });

  it('says nothing about an exercise that was skipped with nothing logged', async () => {
    const session = await startLowerA();
    await skipSessionExercise(session.id, 'ex_leg_curl_a');
    await logSet({
      sessionId: session.id,
      exerciseId: 'ex_hack_squat',
      setIndex: 0,
      load: 60,
      reps: 8,
    });
    await finishSession(session.id);

    const summary = (await getSessionSummary(session.id))!;
    expect(summary.exercises.map((r) => r.exerciseId)).toEqual(['ex_hack_squat']);
  });

  it('still lets those sets hold a record, the way the Records tab reads them', async () => {
    const first = await startLowerA(Date.parse('2026-09-01T10:00:00'));
    await logSet({
      sessionId: first.id,
      exerciseId: 'ex_leg_curl_a',
      setIndex: 0,
      load: 40,
      reps: 10,
    });
    await finishSession(first.id);

    // Second session: one heavier set, then the machine is given up on.
    const second = await startLowerA(Date.parse('2026-09-08T10:00:00'));
    await logSet({
      sessionId: second.id,
      exerciseId: 'ex_leg_curl_a',
      setIndex: 0,
      load: 45,
      reps: 10,
    });
    await skipSessionExercise(second.id, 'ex_leg_curl_a');
    await finishSession(second.id);

    const records = await getSessionRecords(second.id);
    expect(records.map((r) => r.exerciseId)).toEqual(['ex_leg_curl_a']);
    expect(records[0]!.entries.heaviest).toMatchObject({ value: 45 });
  });
});

describe('a bundle carrying tmp_ sets', () => {
  it('exports and re-imports cleanly onto an empty database', async () => {
    const session = await startLowerA(Date.parse('2026-09-12T18:00:00'));
    const swapped = await swapSessionExercise(session.id, 'ex_leg_curl_a', 'cat_walking_lunge');
    await logSet({
      sessionId: session.id,
      exerciseId: swapped.id,
      setIndex: 0,
      load: 20,
      reps: 10,
    });
    await finishSession(session.id);
    const bundle = await exportAll();

    resetSeedGuard();
    await wipeAll();
    const counts = await importMerge(JSON.parse(JSON.stringify(bundle)));
    expect(counts.skipped).toBe(0);
    expect(counts.setLogs).toBe(1);

    // The `tmp_` id has no exercises row, here or anywhere — it resolves
    // through the snapshot that came back with the session.
    expect(await db.exercises.get(swapped.id)).toBeUndefined();
    const detail = (await getSessionDetail(session.id))!;
    expect(detail.exercises.find((e) => e.id === swapped.id)?.name).toBe('Walking lunge');
    expect((await getSessionSummary(session.id))!.volumeKg).toBe(200);
    expect((await getExerciseRecords(swapped.id)).heaviest?.value).toBe(20);
  });
});
