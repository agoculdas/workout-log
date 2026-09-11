import { describe, expect, it } from 'vitest';
import type { ExerciseSessionHistory, Session } from '../../db/types';
import { makeExercise, makeSets } from '../../logic/testFixtures';
import {
  buildSeries,
  chartKindFor,
  completedOnly,
  hasTrend,
  lastChange,
  loadSeries,
  newestFirst,
  paddedDomain,
  repsSeries,
  sessionTime,
  timeSeries,
  volumeSeries,
} from './series';

const DAY = 86_400_000;
const T0 = Date.UTC(2024, 2, 1, 10, 0, 0);
const NOW = T0 + 30 * DAY;

function session(id: string, dayOffset: number, finished = true): Session {
  const startedAt = T0 + dayOffset * DAY;
  return {
    id,
    templateId: 'lowerA',
    startedAt,
    ...(finished ? { finishedAt: startedAt + 3_600_000 } : {}),
  };
}

function history(
  id: string,
  dayOffset: number,
  load: number,
  reps: number[],
  finished = true,
): ExerciseSessionHistory {
  return { session: session(id, dayOffset, finished), sets: makeSets(id, load, reps) };
}

const threeSessions: ExerciseSessionHistory[] = [
  history('s1', 0, 70, [10, 10, 10, 10]),
  history('s2', 3, 75, [9, 9, 8, 8]),
  history('s3', 7, 75, [10, 10, 10, 10]),
];

describe('chartKindFor', () => {
  it('charts load for loaded lifts', () => {
    expect(chartKindFor(makeExercise({ unit: 'kg_total' }))).toBe('load');
    expect(chartKindFor(makeExercise({ unit: 'kg_side' }))).toBe('load');
  });

  it('charts reps when there is no external load', () => {
    expect(chartKindFor(makeExercise({ unit: 'band', increment: 0 }))).toBe('reps');
    expect(chartKindFor(makeExercise({ unit: 'bodyweight', increment: 0 }))).toBe('reps');
    expect(
      chartKindFor(makeExercise({ unit: 'none', increment: 0, type: 'accessory' })),
    ).toBe('reps');
  });

  it('charts time for conditioning measured in seconds', () => {
    const row = makeExercise({
      type: 'conditioning',
      measure: 'seconds',
      unit: 'none',
      increment: 0,
    });
    expect(chartKindFor(row)).toBe('time');
  });

  it('does not treat a timed bodyweight hold as conditioning', () => {
    const plank = makeExercise({ measure: 'seconds', unit: 'bodyweight', increment: 0 });
    expect(chartKindFor(plank)).toBe('reps');
  });
});

describe('completedOnly', () => {
  it('drops unfinished sessions and empty ones, oldest first', () => {
    const rows = completedOnly([
      history('s3', 7, 75, [10]),
      history('live', 9, 80, [10], false),
      { session: session('empty', 5), sets: [] },
      history('s1', 0, 70, [10]),
    ]);
    expect(rows.map((r) => r.session.id)).toEqual(['s1', 's3']);
  });
});

describe('newestFirst', () => {
  it('reverses into display order without mutating the input', () => {
    const input = completedOnly(threeSessions);
    const out = newestFirst(input);
    expect(out.map((h) => h.session.id)).toEqual(['s3', 's2', 's1']);
    expect(input.map((h) => h.session.id)).toEqual(['s1', 's2', 's3']);
  });
});

describe('sessionTime', () => {
  it('prefers finishedAt and falls back to startedAt', () => {
    expect(sessionTime(history('a', 0, 70, [10]))).toBe(T0 + 3_600_000);
    expect(sessionTime(history('b', 0, 70, [10], false))).toBe(T0);
  });
});

describe('series builders', () => {
  const rows = completedOnly(threeSessions);

  it('charts the heaviest set per session', () => {
    expect(loadSeries(rows, NOW).map((p) => p.value)).toEqual([70, 75, 75]);
  });

  it('charts load x reps per session', () => {
    expect(volumeSeries(rows, NOW).map((p) => p.value)).toEqual([2800, 2550, 3000]);
  });

  it('charts total reps per session', () => {
    expect(repsSeries(rows, NOW).map((p) => p.value)).toEqual([40, 34, 40]);
  });

  it('charts the first set as a time for conditioning', () => {
    const rowing = [history('r1', 0, 0, [252]), history('r2', 4, 0, [244])];
    expect(timeSeries(completedOnly(rowing), NOW).map((p) => p.value)).toEqual([252, 244]);
  });

  it('carries the session id and an increasing, labelled x value', () => {
    const points = loadSeries(rows, NOW);
    expect(points.map((p) => p.sessionId)).toEqual(['s1', 's2', 's3']);
    expect(points[0]!.t).toBeLessThan(points[2]!.t);
    points.forEach((p) => expect(p.label.length).toBeGreaterThan(0));
  });

  it('accepts a custom value function', () => {
    expect(buildSeries(rows, (sets) => sets.length, NOW).map((p) => p.value)).toEqual([
      4, 4, 4,
    ]);
  });

  it('is empty for no history', () => {
    expect(loadSeries([], NOW)).toEqual([]);
  });
});

describe('hasTrend', () => {
  it('needs two points', () => {
    const rows = completedOnly(threeSessions);
    expect(hasTrend([])).toBe(false);
    expect(hasTrend(loadSeries(rows.slice(0, 1), NOW))).toBe(false);
    expect(hasTrend(loadSeries(rows, NOW))).toBe(true);
  });
});

describe('paddedDomain', () => {
  it('pads a spread by 5%', () => {
    const domain = paddedDomain(loadSeries(completedOnly(threeSessions), NOW));
    expect(domain).toEqual([69.75, 75.25]);
  });

  it('opens a window around a flat line', () => {
    const flat = buildSeries(completedOnly(threeSessions), () => 80, NOW);
    expect(paddedDomain(flat)).toEqual([72, 88]);
  });

  it('is undefined without points', () => {
    expect(paddedDomain([])).toBeUndefined();
  });
});

describe('lastChange', () => {
  it('is the step from the previous session', () => {
    expect(lastChange(loadSeries(completedOnly(threeSessions), NOW))).toBe(0);
    expect(lastChange(volumeSeries(completedOnly(threeSessions), NOW))).toBe(450);
  });

  it('is undefined with fewer than two points', () => {
    expect(lastChange([])).toBeUndefined();
  });
});
