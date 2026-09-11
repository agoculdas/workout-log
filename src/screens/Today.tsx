import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, Card, ConfirmDialog, PageHeader, Sheet } from '../components';
import {
  deleteSession,
  getActiveSession,
  getLastCompletedSession,
  getLastSessionSetsForExercise,
  getSessionDetail,
  listExercises,
  listSessions,
  listTemplates,
  startSession,
} from '../db/repo';
import { calendarDaysAgo, pickNextSession, type NextSessionPick } from '../logic/nextSession';
import { formatDate, formatLastSession, formatPrescription } from '../logic/format';
import type { Exercise, Session, SetLog, Template, TemplateId } from '../db/types';

interface ActiveInfo {
  session: Session;
  template: Template | undefined;
  loggedSets: number;
}

interface LastInfo {
  session: Session;
  template: Template | undefined;
  daysAgo: number;
}

interface TodayData {
  templates: Template[];
  pick: NextSessionPick;
  template: Template | undefined;
  exercises: Exercise[];
  lastSets: Record<string, SetLog[] | undefined>;
  active: ActiveInfo | undefined;
  last: LastInfo | undefined;
  /** Days since the most recent completed *lower* day, if there is one. */
  lowerDaysAgo: number | undefined;
}

function daysAgoLabel(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/** Time of day, for the header subtitle. */
function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Today: what to train next, why, and one tap to start it. Also surfaces an
 * unfinished session so a session interrupted by a closed tab is resumable.
 */
export function Today() {
  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  const data = useLiveQuery(async (): Promise<TodayData> => {
    const now = Date.now();
    const [templates, lastCompleted, active, completed] = await Promise.all([
      listTemplates(),
      getLastCompletedSession(),
      getActiveSession(),
      listSessions(false),
    ]);

    const pick = pickNextSession(templates, lastCompleted, now);
    const exercises = await listExercises(pick.templateId);

    const lastSets: Record<string, SetLog[] | undefined> = {};
    await Promise.all(
      exercises.map(async (exercise) => {
        lastSets[exercise.id] = await getLastSessionSetsForExercise(exercise.id);
      }),
    );

    let activeInfo: ActiveInfo | undefined;
    if (active) {
      const detail = await getSessionDetail(active.id);
      activeInfo = {
        session: active,
        template: templates.find((t) => t.id === active.templateId),
        loggedSets: detail?.sets.length ?? 0,
      };
    }

    const lowerSession = completed.find(
      (s) => templates.find((t) => t.id === s.templateId)?.kind === 'lower',
    );

    return {
      templates,
      pick,
      template: templates.find((t) => t.id === pick.templateId),
      exercises,
      lastSets,
      active: activeInfo,
      last: lastCompleted
        ? {
            session: lastCompleted,
            template: templates.find((t) => t.id === lastCompleted.templateId),
            daysAgo: calendarDaysAgo(lastCompleted.finishedAt ?? lastCompleted.startedAt, now),
          }
        : undefined,
      lowerDaysAgo: lowerSession
        ? calendarDaysAgo(lowerSession.finishedAt ?? lowerSession.startedAt, now)
        : undefined,
    };
  }, []);

  async function start(templateId: TemplateId): Promise<void> {
    if (starting) return;
    setStarting(true);
    try {
      const session = await startSession(templateId);
      setSheetOpen(false);
      navigate(`/session/${session.id}`);
    } finally {
      setStarting(false);
    }
  }

  async function discardActive(): Promise<void> {
    setDiscardOpen(false);
    if (!data?.active) return;
    await deleteSession(data.active.session.id);
  }

  if (!data) {
    return (
      <div>
        <PageHeader title="Today" />
        <div className="px-4 py-10 text-sm text-muted" role="status">
          Loading…
        </div>
      </div>
    );
  }

  const { active, exercises, last, pick, template } = data;
  const name = template?.name ?? 'Next session';
  /** A lower day trained today or yesterday is the thing we warn about. */
  const lowerRecent = data.lowerDaysAgo !== undefined && data.lowerDaysAgo <= 1;

  return (
    <div>
      <PageHeader title="Today" subtitle={greeting()} />

      <div className="flex flex-col gap-4 px-4 pt-1">
        {active ? (
          <Card className="border-accent/40 bg-accent/5">
            <div className="text-[11px] tracking-wide text-accent uppercase">In progress</div>
            <div className="mt-1 text-lg font-semibold">
              {active.template?.name ?? 'Session'}
            </div>
            <div className="mt-0.5 text-sm text-muted">
              Started {formatDate(active.session.startedAt)} ·{' '}
              {new Date(active.session.startedAt).toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
              })}{' '}
              · {active.loggedSets} set{active.loggedSets === 1 ? '' : 's'} logged
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                className="flex-1"
                onClick={() => navigate(`/session/${active.session.id}`)}
              >
                Resume
              </Button>
              <Button variant="secondary" onClick={() => setDiscardOpen(true)}>
                Discard
              </Button>
            </div>
          </Card>
        ) : null}

        <Card>
          <div className="text-[11px] tracking-wide text-muted uppercase">Next session</div>
          <h2 className="mt-1 text-3xl leading-tight font-bold tracking-tight">{name}</h2>
          {pick.reason ? <p className="mt-2 text-sm text-muted">{pick.reason}</p> : null}

          <ul className="mt-4 flex flex-col divide-y divide-border/60">
            {exercises.map((exercise) => (
              <li key={exercise.id} className="flex items-start gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base">{exercise.name}</div>
                  <div className="text-xs text-muted">
                    {formatLastSession(exercise, data.lastSets[exercise.id])}
                  </div>
                </div>
                <div className="shrink-0 text-sm tabular-nums text-muted">
                  {formatPrescription(exercise)}
                </div>
              </li>
            ))}
            {exercises.length === 0 ? (
              <li className="py-2.5 text-sm text-muted">No exercises in this template yet.</li>
            ) : null}
          </ul>

          <Button
            full
            className="mt-4"
            disabled={starting}
            onClick={() => void start(pick.templateId)}
          >
            Start {name}
          </Button>
        </Card>

        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="min-h-11 text-sm text-muted underline underline-offset-4"
          >
            Choose a different session
          </button>
          <p className="text-xs text-muted">
            {last
              ? `Last: ${last.template?.name ?? 'session'} · ${daysAgoLabel(last.daysAgo)}`
              : 'No completed sessions yet.'}
          </p>
        </div>
      </div>

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Start a session">
        <ul className="flex flex-col gap-1">
          {data.templates.map((t) => {
            const warn = t.kind === 'lower' && lowerRecent;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  disabled={starting}
                  onClick={() => void start(t.id)}
                  className={[
                    'flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left active:bg-surface-2',
                    t.id === pick.templateId ? 'bg-surface-2' : '',
                  ].join(' ')}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-base">{t.name}</span>
                    {warn ? (
                      <span className="block text-xs text-danger/80">
                        You trained lower{' '}
                        {daysAgoLabel(data.lowerDaysAgo ?? 0)} — back-to-back lower days.
                      </span>
                    ) : (
                      <span className="block text-xs text-muted">
                        {t.kind === 'lower' ? 'Lower' : 'Upper'} day
                      </span>
                    )}
                  </span>
                  {t.id === pick.templateId ? (
                    <span className="shrink-0 text-xs text-accent">suggested</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </Sheet>

      <ConfirmDialog
        open={discardOpen}
        title="Discard this session?"
        message="The sets you logged in it will be deleted. This cannot be undone."
        confirmLabel="Discard"
        onConfirm={() => void discardActive()}
        onCancel={() => setDiscardOpen(false)}
      />
    </div>
  );
}

export default Today;
