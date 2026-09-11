import { describe, expect, it } from 'vitest';
import type { CatalogEntry, Exercise, MuscleVolumeResult, Session } from '../../db/types';
import { tallyMuscles } from '../../logic/muscleVolume';
import {
  activeWeeks,
  balanceTiles,
  buildWeekTrend,
  catalogLinks,
  describeMuscles,
  formatPerWeek,
  linkedCatalogIds,
  makeResolver,
  perWeekRows,
  sessionTime,
  setsInSessions,
  splitByVolume,
  windowStart,
  type MuscleSet,
} from './muscleSeries';

const DAY = 86_400_000;
/** A Wednesday, so the Monday week start is two days back. */
const NOW = new Date(2024, 4, 15, 18, 0, 0).getTime();

function entry(id: string, over: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id,
    name: id,
    primary: ['quads'],
    secondary: [],
    equipment: 'barbell',
    pattern: 'squat',
    unilateral: false,
    tags: ['lower'],
    defaultUnit: 'kg_total',
    defaultMeasure: 'reps',
    ...over,
  };
}

function set(sessionId: string, exerciseId: string, completedAt: number): MuscleSet {
  return { sessionId, exerciseId, completedAt };
}

/** A resolver over `exerciseId -> entry` with no db in sight. */
function resolverOf(map: Record<string, CatalogEntry>) {
  return (exerciseId: string) => map[exerciseId];
}

describe('windowStart', () => {
  it('is the Monday of this week for a one-week window', () => {
    const start = windowStart(1, NOW);
    expect(new Date(start).getDay()).toBe(1);
    expect(new Date(start).getDate()).toBe(13);
    expect(new Date(start).getHours()).toBe(0);
  });

  it('reaches back weeks - 1 whole weeks, staying on local midnight over DST', () => {
    // Eight weeks back from mid-May crosses the spring clock change in most of
    // Europe, so the answer is a calendar step, not `- 49 * DAY`.
    for (const [weeks, back] of [
      [4, 21],
      [8, 49],
    ] as const) {
      const start = new Date(windowStart(weeks, NOW));
      const expected = new Date(windowStart(1, NOW));
      expected.setDate(expected.getDate() - back);
      expect(start.getTime()).toBe(expected.getTime());
      expect(start.getDay()).toBe(1);
      expect(start.getHours()).toBe(0);
    }
  });

  it('never goes below one week', () => {
    expect(windowStart(0, NOW)).toBe(windowStart(1, NOW));
  });
});

describe('catalogLinks', () => {
  const session: Session = {
    id: 's1',
    templateId: 'lowerA',
    startedAt: NOW - DAY,
    finishedAt: NOW - DAY + 3_600_000,
    exercises: [
      {
        id: 'e1',
        name: 'Squat',
        sets: 3,
        repMin: 5,
        repMax: 5,
        measure: 'reps',
        perSide: false,
        unit: 'kg_total',
        type: 'primary',
        catalogId: 'cat_old',
      },
    ],
  };
  const exercise = {
    id: 'e1',
    templateId: 'lowerA',
    name: 'Squat',
    catalogId: 'cat_new',
    order: 0,
    sets: 3,
    repMin: 5,
    repMax: 5,
    measure: 'reps',
    perSide: false,
    unit: 'kg_total',
    increment: 2.5,
    type: 'primary',
  } satisfies Exercise;

  it('prefers the snapshot link over the live row', () => {
    expect(catalogLinks([session], [exercise]).get('e1')).toBe('cat_old');
  });

  it('falls back to the live row for sessions with no snapshot', () => {
    const legacy: Session = { ...session, exercises: undefined };
    expect(catalogLinks([legacy], [exercise]).get('e1')).toBe('cat_new');
  });

  it('collects the distinct catalogue ids to fetch', () => {
    const links = catalogLinks([session], [exercise, { ...exercise, id: 'e2' }]);
    expect(linkedCatalogIds(links).sort()).toEqual(['cat_new', 'cat_old']);
  });

  it('resolves through the fetched entries and misses gracefully', () => {
    const links = catalogLinks([], [exercise]);
    const resolve = makeResolver(links, new Map([['cat_new', entry('cat_new')]]));
    expect(resolve('e1')?.id).toBe('cat_new');
    expect(resolve('unknown')).toBeUndefined();
  });
});

describe('setsInSessions', () => {
  it('drops sets belonging to a session that is not in the list', () => {
    const sets = [set('s1', 'e1', NOW), set('live', 'e1', NOW)];
    const kept = setsInSessions(sets as never, [{ id: 's1' } as Session]);
    expect(kept.map((s) => s.sessionId)).toEqual(['s1']);
  });
});

describe('buildWeekTrend', () => {
  const resolve = resolverOf({
    e1: entry('cat_squat', { primary: ['quads'], secondary: ['glutes'] }),
  });
  const monday = windowStart(1, NOW);

  it('emits one point per week, oldest first, with empty weeks at zero', () => {
    // Two sets this week, one three weeks ago; the two weeks between are empty.
    const sets = [
      set('s1', 'e1', monday + 3 * DAY),
      set('s1', 'e1', monday + 3 * DAY),
      set('s0', 'e1', monday - 21 * DAY + DAY),
    ];
    const points = buildWeekTrend(
      sets,
      [monday + 3 * DAY, monday - 21 * DAY + DAY],
      resolve,
      4,
      NOW,
    );
    expect(points).toHaveLength(4);
    expect(points.map((p) => p.t)).toEqual([
      monday - 21 * DAY,
      monday - 14 * DAY,
      monday - 7 * DAY,
      monday,
    ]);
    // 1 primary + 0.5 secondary per set.
    expect(points.map((p) => p.value)).toEqual([1.5, 0, 0, 3]);
    expect(points.map((p) => p.sessions)).toEqual([1, 0, 0, 1]);
  });

  it('ignores sets that fall outside the window', () => {
    const points = buildWeekTrend([set('s0', 'e1', monday - 30 * DAY)], [], resolve, 4, NOW);
    expect(points.map((p) => p.value)).toEqual([0, 0, 0, 0]);
  });

  it('counts a week with sets but no resolvable entry as zero', () => {
    const points = buildWeekTrend(
      [set('s1', 'unlinked', monday + DAY)],
      [monday + DAY],
      resolve,
      1,
      NOW,
    );
    expect(points[0]!.value).toBe(0);
    expect(points[0]!.sessions).toBe(1);
  });
});

describe('activeWeeks', () => {
  const point = (sessions: number) => ({ t: 0, label: '', value: 0, sessions });

  it('counts only the weeks that trained', () => {
    expect(activeWeeks([point(1), point(0), point(0), point(2)])).toBe(2);
  });

  it('is zero for an untrained window', () => {
    expect(activeWeeks([point(0), point(0)])).toBe(0);
    expect(activeWeeks([])).toBe(0);
  });
});

describe('perWeekRows', () => {
  /** Squat x4 sets (quads primary, glutes secondary) + bench x2 sets. */
  const volume: MuscleVolumeResult = tallyMuscles(
    [
      set('s1', 'squat', 0),
      set('s1', 'squat', 0),
      set('s1', 'squat', 0),
      set('s1', 'squat', 0),
      set('s2', 'bench', 0),
      set('s2', 'bench', 0),
      set('s3', 'unlinked', 0),
    ],
    resolverOf({
      squat: entry('cat_squat', { primary: ['quads'], secondary: ['glutes'] }),
      bench: entry('cat_bench', { primary: ['chest'], secondary: ['triceps'] }),
    }),
  );

  it('averages over the active weeks, not the window length', () => {
    const overTwo = perWeekRows(volume, 2);
    const overFour = perWeekRows(volume, 4);
    expect(overTwo[0]).toMatchObject({ muscle: 'quads', perWeek: 2, weightedSets: 4, sessions: 1 });
    expect(overFour[0]).toMatchObject({ muscle: 'quads', perWeek: 1 });
  });

  it('sorts by volume desc and keeps every muscle', () => {
    const rows = perWeekRows(volume, 1);
    expect(rows.map((r) => r.muscle).slice(0, 4)).toEqual([
      'quads',
      'glutes',
      'chest',
      'triceps',
    ]);
    expect(rows.map((r) => r.perWeek).slice(0, 4)).toEqual([4, 2, 2, 1]);
    expect(rows).toHaveLength(17);
  });

  it('is empty with no active week, rather than dividing by zero', () => {
    expect(perWeekRows(volume, 0)).toEqual([]);
    expect(perWeekRows(volume, -1)).toEqual([]);
    expect(perWeekRows(undefined, 4)).toEqual([]);
  });

  it('collapses the muscles with nothing in them', () => {
    const { trained, untouched } = splitByVolume(perWeekRows(volume, 1));
    expect(trained.map((r) => r.muscle)).toEqual(['quads', 'glutes', 'chest', 'triceps']);
    expect(untouched).toHaveLength(13);
    expect(untouched.every((r) => r.perWeek === 0)).toBe(true);
  });

  it('labels bars to one decimal', () => {
    expect(formatPerWeek(12)).toBe('12.0');
    expect(formatPerWeek(8.25)).toBe('8.3');
    expect(formatPerWeek(0)).toBe('0.0');
  });
});

describe('balanceTiles', () => {
  it('normalises the smaller side to 1.0', () => {
    const [pushPull] = balanceTiles({ push: 10, pull: 12, squat: 0, hinge: 0 });
    expect(pushPull).toMatchObject({ id: 'pushPull', title: 'Push : Pull', ratio: '1.0 : 1.2' });
    expect(pushPull!.hint).toBeUndefined();
  });

  it('hints when one side is more than 1.5x the other', () => {
    expect(balanceTiles({ push: 4, pull: 10, squat: 0, hinge: 0 })[0]!.hint).toBe('Pull-heavy');
    expect(balanceTiles({ push: 10, pull: 4, squat: 0, hinge: 0 })[0]!.hint).toBe('Push-heavy');
    expect(balanceTiles({ push: 0, pull: 0, squat: 9, hinge: 2 })[0]!.hint).toBe('Quad-heavy');
    expect(balanceTiles({ push: 0, pull: 0, squat: 2, hinge: 9 })[0]!.hint).toBe('Hinge-heavy');
  });

  it('does not hint at exactly 1.5x', () => {
    expect(balanceTiles({ push: 4, pull: 6, squat: 0, hinge: 0 })[0]!.hint).toBeUndefined();
  });

  it('drops a tile with nothing on either side', () => {
    expect(balanceTiles({ push: 3, pull: 3, squat: 0, hinge: 0 }).map((t) => t.id)).toEqual([
      'pushPull',
    ]);
    expect(balanceTiles({ push: 0, pull: 0, squat: 0, hinge: 0 })).toEqual([]);
    expect(balanceTiles(undefined)).toEqual([]);
  });

  it('handles an empty side without dividing by zero', () => {
    const [tile] = balanceTiles({ push: 0, pull: 6, squat: 0, hinge: 0 });
    expect(tile).toMatchObject({ ratio: '0.0 : 1.0', hint: 'Pull-heavy' });
  });
});

describe('describeMuscles', () => {
  it('reads primaries then secondaries in sentence case', () => {
    expect(describeMuscles({ primary: ['quads'], secondary: ['glutes', 'adductors'] })).toBe(
      'Quads · Glutes, adductors',
    );
  });

  it('omits an empty half', () => {
    expect(describeMuscles({ primary: ['chest'], secondary: [] })).toBe('Chest');
    expect(describeMuscles({ primary: [], secondary: ['core'] })).toBe('Core');
    expect(describeMuscles({ primary: [], secondary: [] })).toBe('');
  });
});

describe('sessionTime', () => {
  it('prefers when the session finished', () => {
    expect(sessionTime({ id: 's', templateId: 'lowerA', startedAt: 1, finishedAt: 9 })).toBe(9);
    expect(sessionTime({ id: 's', templateId: 'lowerA', startedAt: 1 })).toBe(1);
  });
});
