import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, Card, Chip } from '../../components';
import {
  getCatalogEntriesByIds,
  getMuscleVolume,
  getPatternBalance,
  listAllSetLogs,
  listExercises,
  listSessions,
  readSettings,
} from '../../db/repo';
import { MuscleBarsChart, WeekTrendChart } from './charts';
import {
  activeWeeks,
  balanceTiles,
  buildWeekTrend,
  catalogLinks,
  formatPerWeek,
  linkedCatalogIds,
  makeResolver,
  MUSCLE_WINDOWS,
  perWeekRows,
  sessionTime,
  setsInSessions,
  splitByVolume,
  windowStart,
  type MuscleBarRow,
  type WindowWeeks,
} from './muscleSeries';
import ReviewSheet from './ReviewSheet';

/**
 * History → Muscles: how the logged sets landed across the body over the last
 * week / 4 weeks / 8 weeks. Everything is weighted sets — a set counts 1 for
 * each primary muscle of its catalogue entry and 0.5 for each secondary one —
 * and "per week" averages over the weeks that actually trained, so a fresh log
 * (or a week off) does not quietly halve every number.
 */
export function MusclesSection() {
  const [weeks, setWeeks] = useState<WindowWeeks>(4);
  const [showEmpty, setShowEmpty] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const windowLabel = MUSCLE_WINDOWS.find((w) => w.weeks === weeks)?.label ?? 'this window';

  const data = useLiveQuery(async () => {
    const now = Date.now();
    const from = windowStart(weeks, now);
    const [volume, balance, allSets, sessions, exercises, settings] = await Promise.all([
      getMuscleVolume({ from, to: now }),
      getPatternBalance({ from, to: now }),
      listAllSetLogs(),
      listSessions(false),
      listExercises(undefined, true),
      readSettings(),
    ]);
    const links = catalogLinks(sessions, exercises);
    const catalog = await getCatalogEntriesByIds(linkedCatalogIds(links));
    const trend = buildWeekTrend(
      setsInSessions(allSets, sessions),
      sessions.map(sessionTime),
      makeResolver(links, catalog),
      weeks,
      now,
    );
    return { volume, balance, trend, band: settings?.setsPerMuscleTarget };
  }, [weeks]);

  const chips = (
    <div role="group" aria-label="Window" className="flex gap-2 overflow-x-auto pb-0.5">
      {MUSCLE_WINDOWS.map((option) => (
        <Chip
          key={option.weeks}
          selected={weeks === option.weeks}
          onClick={() => setWeeks(option.weeks)}
        >
          {option.label}
        </Chip>
      ))}
    </div>
  );

  if (data === undefined) {
    return (
      <div className="space-y-4 px-4 pb-8">
        {chips}
        <p className="text-sm text-muted">Loading…</p>
      </div>
    );
  }

  const { volume, balance, trend, band } = data;
  const trained = activeWeeks(trend);
  const sessionCount = trend.reduce((sum, point) => sum + point.sessions, 0);
  const rows = perWeekRows(volume, trained);
  const split = splitByVolume(rows);
  const bars = showEmpty ? rows : split.trained;
  const tiles = balanceTiles(balance);

  if (!trained) {
    return (
      <div className="space-y-4 px-4 pb-8">
        {chips}
        <Card className="text-sm text-muted">
          No finished sessions in this window — log one from Today, or widen the window.
        </Card>
        <div>
          <Button variant="secondary" full disabled>
            Review this window
          </Button>
          <p className="mt-1 text-xs text-muted">Nothing to review in this window.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-4 pb-8">
      {chips}

      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-2xl font-bold tabular-nums">
            {formatPerWeek(totalPerWeek(rows))}
          </div>
          <div className="text-xs text-muted">
            weighted sets per week · {sessionCount} session{sessionCount === 1 ? '' : 's'} over{' '}
            {trained} active week{trained === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      <MuscleBarsChart
        data={bars}
        aside={`${split.trained.length} muscle${split.trained.length === 1 ? '' : 's'}`}
        band={band}
        caption={band ? `Shaded band: ${band.min}–${band.max} sets/week` : undefined}
      />

      {split.untouched.length ? (
        <button
          type="button"
          aria-expanded={showEmpty}
          onClick={() => setShowEmpty((v) => !v)}
          className="min-h-11 text-sm text-accent underline-offset-2 active:underline"
        >
          {showEmpty ? 'Hide' : 'Show'} muscles with no sets ({split.untouched.length})
        </button>
      ) : null}

      <MuscleTable rows={bars} />

      {volume.unlinkedSets > 0 ? (
        <p className="text-xs text-muted">
          {volume.unlinkedSets} set{volume.unlinkedSets === 1 ? " isn't" : "s aren't"} linked to a
          library entry and {volume.unlinkedSets === 1 ? 'is' : 'are'} not counted. Link exercises
          in Programme → Days.
        </p>
      ) : null}

      <WeekTrendChart
        data={trend}
        aside={trend.length > 1 ? `${trend.length} weeks` : undefined}
      />

      {tiles.length ? (
        <section>
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Balance</h3>
          <div className="grid grid-cols-2 gap-3">
            {tiles.map((tile) => (
              <div
                key={tile.id}
                className="min-w-0 rounded-2xl border border-border/70 bg-surface p-3"
              >
                <div className="truncate text-xs text-muted">{tile.title}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{tile.ratio}</div>
                <div className="mt-0.5 truncate text-xs text-muted">
                  {tile.hint ?? `${tile.left + tile.right} sets`}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <Button variant="secondary" full disabled={!band} onClick={() => setReviewOpen(true)}>
        Review this window
      </Button>

      {band ? (
        <ReviewSheet
          open={reviewOpen}
          onClose={() => setReviewOpen(false)}
          rows={rows}
          target={band}
          activeWeeks={trained}
          windowLabel={windowLabel}
        />
      ) : null}
    </div>
  );
}

/** Muscle · sets per week · sessions, in the same order as the bars. */
function MuscleTable({ rows }: { rows: MuscleBarRow[] }) {
  if (!rows.length) return null;
  return (
    <Card flush className="overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 text-xs tracking-wide text-muted uppercase">
            <th scope="col" className="px-4 py-2 text-left font-medium">
              Muscle
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              Sets/week
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Sessions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {rows.map((row) => (
            <tr key={row.muscle}>
              <td className="px-4 py-2">{row.label}</td>
              <td className="px-2 py-2 text-right tabular-nums">{formatPerWeek(row.perWeek)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-muted">{row.sessions}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function totalPerWeek(rows: MuscleBarRow[]): number {
  return rows.reduce((sum, row) => sum + row.perWeek, 0);
}

export default MusclesSection;
