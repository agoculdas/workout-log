import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Card, PageHeader } from '../components';
import { getCatalogEntry, getExercise, getExerciseHistory, getTemplate } from '../db/repo';
import type { CatalogEntry, Exercise, ExerciseSessionHistory, SetLog } from '../db/types';
import {
  formatDate,
  formatDuration,
  formatLoad,
  formatMassUnit,
  formatNumber,
  formatPrescription,
  formatSetSummary,
} from '../logic/format';
import {
  RECORD_LABELS,
  computeRecords,
  formatRecord,
  recordKindsFor,
} from '../logic/records';
import { isStalled, stallApplies } from '../logic/stall';
import { exerciseMassUnit, massLabel } from '../logic/units';
import { TrendChart } from './history/charts';
import { CHART_COLORS } from './history/chartTheme';
import EditSetSheet from './history/EditSetSheet';
import { describeMuscles } from './history/muscleSeries';
import { formatSetLine, orderedSetLines, setLineLabel } from './history/setLine';
import {
  chartKindFor,
  completedOnly,
  loadSeries,
  newestFirst,
  repsSeries,
  timeSeries,
  volumeSeries,
} from './history/series';

/** One exercise over time: two charts plus every session that logged it. */
export function ExerciseHistory() {
  const { exerciseId } = useParams<{ exerciseId: string }>();

  const data = useLiveQuery(async () => {
    if (!exerciseId) return null;
    const exercise = await getExercise(exerciseId);
    if (!exercise) return null;
    const [template, history, entry] = await Promise.all([
      getTemplate(exercise.templateId),
      getExerciseHistory(exerciseId),
      exercise.catalogId ? getCatalogEntry(exercise.catalogId) : undefined,
    ]);
    return { exercise, templateName: template?.name, history, entry };
  }, [exerciseId]);

  const back = (
    <Link
      to="/history"
      aria-label="Back to history"
      className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted active:bg-surface-2"
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 5l-7 7 7 7"
        />
      </svg>
    </Link>
  );

  if (data === undefined) {
    return (
      <div>
        <PageHeader title="Exercise" leading={back} />
        <p className="px-4 py-6 text-sm text-muted">Loading…</p>
      </div>
    );
  }

  if (data === null) {
    return (
      <div>
        <PageHeader title="Not found" leading={back} />
        <p className="px-4 py-6 text-sm text-muted">
          That exercise no longer exists.{' '}
          <Link to="/history" className="text-accent">
            Back to history
          </Link>
          .
        </p>
      </div>
    );
  }

  const { exercise, templateName, history, entry } = data;
  const completed = completedOnly(history);
  // The stall rule counts reps, so a rowing time that keeps dropping would read
  // as a regression. Work scored on the clock never gets the badge.
  const stalled = stallApplies(exercise) && isStalled(completed.map((h) => h.sets));

  return (
    <div>
      <PageHeader
        title={exercise.name}
        leading={back}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {templateName ? <span>{templateName}</span> : null}
            <span aria-hidden="true">·</span>
            <span>{formatPrescription(exercise)}</span>
            {stalled ? (
              <span className="rounded-full bg-danger/15 px-2 py-0.5 text-xs font-medium text-danger">
                stalled
              </span>
            ) : null}
          </span>
        }
      />

      <div className="space-y-3 px-4 pb-4">
        <MuscleLine entry={entry} />
        <Records exercise={exercise} history={completed} />
        <Charts exercise={exercise} history={completed} />
      </div>

      <div className="px-4 pb-8">
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
          Sessions
        </h2>
        {completed.length ? (
          <ul className="space-y-2">
            {newestFirst(completed).map((entry) => (
              <SessionRow key={entry.session.id} exercise={exercise} entry={entry} />
            ))}
          </ul>
        ) : (
          <Card className="text-sm text-muted">
            Nothing logged for this exercise yet.
          </Card>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- muscle line */

/**
 * What the movement trains, when the programme row is linked to the library.
 * Unlinked rows show nothing — the muscle report says so on their behalf.
 */
function MuscleLine({ entry }: { entry: CatalogEntry | undefined }) {
  if (!entry) return null;
  const muscles = describeMuscles(entry);
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
      {muscles ? <span className="min-w-0">{muscles}</span> : null}
      <Link
        to={`/programme/library/${entry.id}`}
        className="text-accent underline-offset-2 active:underline"
      >
        View in library
      </Link>
    </p>
  );
}

/* ------------------------------------------------------------------ records */

/**
 * The best numbers this exercise holds, one line each. Plain facts with the
 * date they were set — nothing here suggests anything.
 */
function Records({
  exercise,
  history,
}: {
  exercise: Exercise;
  history: ExerciseSessionHistory[];
}) {
  const records = computeRecords(exercise, history);
  const kinds = recordKindsFor(exercise).filter((kind) => records[kind] !== undefined);
  if (!kinds.length) return null;

  return (
    <section>
      <h2 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">
        Records
      </h2>
      <ul className="space-y-1">
        {kinds.map((kind) => {
          const entry = records[kind];
          if (!entry) return null;
          return (
            <li key={kind} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="text-muted">{RECORD_LABELS[kind]}</span>{' '}
                <span className="tabular-nums">{formatRecord(exercise, kind, entry)}</span>
              </span>
              <span className="shrink-0 text-xs text-muted">{formatDate(entry.at)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------------- charts */

function Charts({
  exercise,
  history,
}: {
  exercise: Exercise;
  history: ExerciseSessionHistory[];
}) {
  const kind = chartKindFor(exercise);

  if (kind === 'time') {
    const points = timeSeries(history);
    const latest = points[points.length - 1];
    return (
      <TrendChart
        title="Time — lower is better"
        data={points}
        formatValue={(v) => formatDuration(v)}
        aside={latest ? formatDuration(latest.value) : undefined}
      />
    );
  }

  const volume = volumeSeries(history);
  const latestVolume = volume[volume.length - 1];
  // Band and bodyweight work logs load 0, so volume would be a flat zero line.
  const volumeChart = volume.some((p) => p.value > 0) ? (
    <TrendChart
      title={volumeTitle(exercise)}
      data={volume}
      color={CHART_COLORS.accentStrong}
      formatValue={(v) => compact(v)}
      aside={latestVolume ? compact(latestVolume.value) : undefined}
    />
  ) : null;

  if (kind === 'reps') {
    const reps = repsSeries(history);
    const latest = reps[reps.length - 1];
    const timed = exercise.measure === 'seconds';
    const format = (v: number) => (timed ? formatDuration(v) : formatNumber(v));
    return (
      <>
        <TrendChart
          title={timed ? 'Total time under tension' : 'Total reps'}
          data={reps}
          formatValue={format}
          aside={latest ? format(latest.value) : undefined}
        />
        {volumeChart}
      </>
    );
  }

  const loads = loadSeries(history);
  const latestLoad = loads[loads.length - 1];
  return (
    <>
      <TrendChart
        title={`Top set load${unitSuffix(exercise)}`}
        data={loads}
        formatValue={(v) => formatNumber(v)}
        aside={latestLoad ? formatLoad(exercise, latestLoad.value) : undefined}
      />
      {volumeChart}
    </>
  );
}

/* --------------------------------------------------------------- session row */

function SessionRow({
  exercise,
  entry,
}: {
  exercise: Exercise;
  entry: ExerciseSessionHistory;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<{ set: SetLog; label: string } | null>(null);
  const when = entry.session.finishedAt ?? entry.session.startedAt;
  // The name this exercise had when the session was logged, if it has changed.
  const snapshotName = entry.session.exercises?.find((e) => e.id === exercise.id)?.name;
  const wasCalled = snapshotName && snapshotName !== exercise.name ? snapshotName : undefined;

  return (
    <li>
      <Card flush className="overflow-hidden">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-surface-2"
        >
          <span className="w-20 shrink-0 text-sm text-muted">{formatDate(when)}</span>
          <span className="min-w-0 flex-1 truncate text-sm tabular-nums">
            {formatSetSummary(exercise, entry.sets)}
          </span>
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className={['h-4 w-4 shrink-0 text-muted transition-transform', open ? 'rotate-180' : '']
              .filter(Boolean)
              .join(' ')}
          >
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 9l6 6 6-6"
            />
          </svg>
        </button>
        {open ? (
          <div className="border-t border-border/60 px-4 py-2">
            {wasCalled ? (
              <p className="pb-1 text-xs text-muted">was: {wasCalled}</p>
            ) : null}
            <ul>
              {orderedSetLines(entry.sets).map((line) => (
                <li
                  key={line.set.id}
                  className={[
                    'flex items-center gap-3 text-sm',
                    line.warmup ? 'text-muted/70' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span className="w-12 shrink-0 text-muted">
                    {line.warmup ? 'W' : `set ${line.index}`}
                  </span>
                  <span className="min-w-0 flex-1 truncate tabular-nums">
                    {formatSetLine(exercise, line.set)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditing({ set: line.set, label: setLineLabel(line) })}
                    className="min-h-11 shrink-0 rounded-lg px-3 text-sm text-accent active:bg-surface-2"
                  >
                    Edit
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      {editing ? (
        <EditSetSheet
          key={editing.set.id}
          set={editing.set}
          exercise={exercise}
          setLabel={editing.label}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------ helpers */

/** " (lb/hand)" — the y axis is in the exercise's own denomination. */
function unitSuffix(exercise: Exercise): string {
  if (exercise.unit === 'kg_side' || exercise.unit === 'kg_total') {
    return ` (${formatMassUnit(exercise)})`;
  }
  return '';
}

/**
 * Volume charts stay in the exercise's own numbers (see `totalVolume`), so the
 * title has to say when those numbers are pounds. Kilograms are the default and
 * go unsaid.
 */
function volumeTitle(exercise: Exercise): string {
  return exerciseMassUnit(exercise) === 'lb'
    ? `Volume (${massLabel('lb')})`
    : 'Volume';
}

/** 3200 -> "3,200", 18400 -> "18.4k" — keeps the y axis narrow. */
function compact(value: number): string {
  if (Math.abs(value) >= 10_000) {
    return `${Number((value / 1000).toFixed(1))}k`;
  }
  return Math.round(value).toLocaleString();
}

export default ExerciseHistory;
