import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, Card, ConfirmDialog, PageHeader } from '../components';
import {
  deleteSession,
  getSessionDetail,
  listAllSetLogs,
  listExercises,
  listSessions,
  listTemplates,
} from '../db/repo';
import type { Session, SetLog } from '../db/types';
import { formatDate, formatSetSummary } from '../logic/format';
import { totalVolume } from '../logic/volume';
import { BodyweightSection } from './history/Bodyweight';

type Segment = 'sessions' | 'bodyweight';

/** History: completed sessions, a jump list of exercises, and the weight log. */
export function History() {
  const [segment, setSegment] = useState<Segment>('sessions');

  return (
    <div>
      <PageHeader title="History" />
      <div className="px-4 pb-4">
        <div
          role="tablist"
          aria-label="History view"
          className="flex gap-1 rounded-xl border border-border/70 bg-surface p-1"
        >
          {(
            [
              ['sessions', 'Sessions'],
              ['bodyweight', 'Bodyweight'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={segment === value}
              onClick={() => setSegment(value)}
              className={[
                'min-h-11 flex-1 rounded-lg text-sm font-medium transition-colors',
                segment === value ? 'bg-surface-2 text-fg' : 'text-muted',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {segment === 'sessions' ? <SessionsSection /> : <BodyweightSection />}
    </div>
  );
}

/* ------------------------------------------------------------------ sessions */

interface SessionRow {
  session: Session;
  templateName: string;
  setCount: number;
  volume: number;
}

function SessionsSection() {
  const rows = useLiveQuery(async () => {
    const [sessions, templates, sets] = await Promise.all([
      listSessions(false),
      listTemplates(),
      listAllSetLogs(),
    ]);
    const nameById = new Map(templates.map((t) => [t.id, t.name]));
    const bySession = new Map<string, SetLog[]>();
    for (const set of sets) {
      const list = bySession.get(set.sessionId);
      if (list) list.push(set);
      else bySession.set(set.sessionId, [set]);
    }
    return sessions.map((session): SessionRow => {
      const own = bySession.get(session.id) ?? [];
      return {
        session,
        templateName: nameById.get(session.templateId) ?? session.templateId,
        setCount: own.length,
        volume: totalVolume(own),
      };
    });
  }, []);

  const [expanded, setExpanded] = useState<string | null>(null);

  if (rows === undefined) {
    return <p className="px-4 py-6 text-sm text-muted">Loading…</p>;
  }

  if (!rows.length) {
    return (
      <div className="px-4 pb-8">
        <Card className="text-sm text-muted">
          No sessions yet — start one from Today.
        </Card>
        <ExerciseIndex className="mt-4" />
      </div>
    );
  }

  const months = groupByMonth(rows);

  return (
    <div className="px-4 pb-8">
      {months.map((month) => (
        <section key={month.key} className="mb-6">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
            {month.label}
          </h2>
          <ul className="space-y-2">
            {month.rows.map((row) => (
              <li key={row.session.id}>
                <Card flush className="overflow-hidden">
                  <button
                    type="button"
                    aria-expanded={expanded === row.session.id}
                    onClick={() =>
                      setExpanded((id) => (id === row.session.id ? null : row.session.id))
                    }
                    className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-surface-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{row.templateName}</div>
                      <div className="mt-0.5 text-xs text-muted">
                        {formatDate(row.session.finishedAt ?? row.session.startedAt)} ·{' '}
                        {formatSessionLength(row.session)} · {row.setCount} set
                        {row.setCount === 1 ? '' : 's'} · {formatVolume(row.volume)}
                      </div>
                    </div>
                    <Chevron open={expanded === row.session.id} />
                  </button>
                  {expanded === row.session.id ? (
                    <SessionDetail
                      sessionId={row.session.id}
                      onDeleted={() => setExpanded(null)}
                    />
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <ExerciseIndex />
    </div>
  );
}

function SessionDetail({
  sessionId,
  onDeleted,
}: {
  sessionId: string;
  onDeleted: () => void;
}) {
  const detail = useLiveQuery(() => getSessionDetail(sessionId), [sessionId]);
  const [confirming, setConfirming] = useState(false);

  if (!detail) {
    return <div className="border-t border-border/60 px-4 py-3 text-sm text-muted">Loading…</div>;
  }

  const logged = detail.exercises.filter((e) => detail.setsByExercise[e.id]?.length);

  return (
    <div className="border-t border-border/60 px-4 py-3">
      {logged.length ? (
        <ul className="space-y-1">
          {logged.map((exercise) => (
            <li key={exercise.id} className="flex items-baseline gap-3">
              <Link
                to={`/history/${exercise.id}`}
                className="min-w-0 flex-1 truncate text-sm text-accent underline-offset-2 active:underline"
              >
                {exercise.name}
              </Link>
              <span className="shrink-0 text-sm tabular-nums text-muted">
                {formatSetSummary(exercise, detail.setsByExercise[exercise.id] ?? [])}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No sets were logged in this session.</p>
      )}

      {detail.session.notes ? (
        <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-sm whitespace-pre-wrap text-muted">
          {detail.session.notes}
        </p>
      ) : null}

      <div className="mt-3 flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
          Delete session
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Delete this session?"
        message="The session and every set logged in it are removed. This cannot be undone."
        confirmLabel="Delete"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onDeleted();
          void deleteSession(sessionId);
        }}
      />
    </div>
  );
}

/* ----------------------------------------------------------- exercise index */

/** Every exercise, grouped by day — a chart is one tap away without expanding. */
function ExerciseIndex({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const groups = useLiveQuery(async () => {
    const [templates, exercises] = await Promise.all([listTemplates(), listExercises()]);
    return templates.map((template) => ({
      template,
      exercises: exercises.filter((e) => e.templateId === template.id),
    }));
  }, []);

  return (
    <section className={className}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-12 w-full items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase"
      >
        Exercises
        <span className="flex-1 border-t border-border/60" />
        <Chevron open={open} />
      </button>
      {open ? (
        <div className="mt-2 space-y-4">
          {(groups ?? []).map(({ template, exercises }) => (
            <div key={template.id}>
              <h3 className="mb-1 text-sm font-semibold">{template.name}</h3>
              <Card flush>
                <ul className="divide-y divide-border/60">
                  {exercises.map((exercise) => (
                    <li key={exercise.id}>
                      <Link
                        to={`/history/${exercise.id}`}
                        className="flex min-h-12 items-center gap-3 px-4 py-2 text-sm active:bg-surface-2"
                      >
                        <span className="min-w-0 flex-1 truncate">{exercise.name}</span>
                        <Chevron open={false} className="-rotate-90" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ helpers */

function Chevron({ open, className = '' }: { open: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={[
        'h-4 w-4 shrink-0 text-muted transition-transform',
        open ? 'rotate-180' : '',
        className,
      ]
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
  );
}

/** "58 min" / "1 h 12" — a workout is minutes, never seconds. */
function formatSessionLength(session: Session): string {
  if (session.finishedAt === undefined) return 'in progress';
  const minutes = Math.max(0, Math.round((session.finishedAt - session.startedAt) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

/** Volume is a big number — thousands separators, no decimals. */
function formatVolume(volume: number): string {
  if (volume <= 0) return '—';
  return `${Math.round(volume).toLocaleString()} kg`;
}

interface MonthGroup {
  key: string;
  label: string;
  rows: SessionRow[];
}

/** Rows arrive newest first; keep that order inside each month. */
function groupByMonth(rows: SessionRow[]): MonthGroup[] {
  const out: MonthGroup[] = [];
  for (const row of rows) {
    const when = new Date(row.session.finishedAt ?? row.session.startedAt);
    const key = `${when.getFullYear()}-${when.getMonth()}`;
    const last = out[out.length - 1];
    if (last && last.key === key) last.rows.push(row);
    else {
      out.push({
        key,
        label: when.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
        rows: [row],
      });
    }
  }
  return out;
}

export default History;
