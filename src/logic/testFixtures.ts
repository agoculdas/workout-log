import type { Exercise, SetLog } from '../db/types';

/** Test-only builders. Kept out of `*.test.ts` so several suites can share them. */
export function makeExercise(patch: Partial<Exercise> = {}): Exercise {
  return {
    id: 'ex1',
    templateId: 'lowerA',
    name: 'Hack squat',
    order: 0,
    sets: 4,
    repMin: 8,
    repMax: 10,
    measure: 'reps',
    perSide: false,
    unit: 'kg_total',
    increment: 5,
    type: 'primary',
    archived: false,
    ...patch,
  };
}

let seq = 0;

/** Builds one session's worth of sets: `sets(sessionId, load, [10,10,10,10])`. */
export function makeSets(
  sessionId: string,
  load: number,
  reps: number[],
  opts: {
    exerciseId?: string;
    completedAt?: number;
    kind?: SetLog['kind'];
    toFailure?: boolean;
    massUnit?: SetLog['massUnit'];
    unit?: SetLog['unit'];
  } = {},
): SetLog[] {
  const base = opts.completedAt ?? 1_700_000_000_000;
  return reps.map((r, i) => ({
    id: `set_${seq++}`,
    sessionId,
    exerciseId: opts.exerciseId ?? 'ex1',
    setIndex: i,
    load,
    reps: r,
    completedAt: base + i * 60_000,
    ...(opts.kind ? { kind: opts.kind } : {}),
    ...(opts.toFailure === undefined ? {} : { toFailure: opts.toFailure }),
    ...(opts.massUnit ? { massUnit: opts.massUnit } : {}),
    ...(opts.unit ? { unit: opts.unit } : {}),
  }));
}

/** One warm-up row, to prove the maths ignores it. */
export function makeWarmup(
  sessionId: string,
  load: number,
  reps: number,
  opts: { exerciseId?: string; completedAt?: number; massUnit?: SetLog['massUnit'] } = {},
): SetLog {
  return makeSets(sessionId, load, [reps], { ...opts, kind: 'warmup' })[0]!;
}
