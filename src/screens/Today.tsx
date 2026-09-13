import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, Card, ConfirmDialog, PageHeader, Sheet } from '../components';
import {
  deleteSession,
  getActiveSession,
  getActiveProgramme,
  getLastSessionSetsForExercise,
  getSessionDetail,
  listAllTemplates,
  listExercises,
  listSessions,
  listTemplates,
  readSettings,
  startSession,
} from '../db/repo';
import { calendarDaysAgo, pickNextSession, type NextSessionPick } from '../logic/nextSession';
import { dayKindLabel, isLowerDay } from '../logic/days';
import { formatDate, formatLastSession, formatPrescription } from '../logic/format';
import type { Exercise, Programme, Session, SetLog, Template } from '../db/types';

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
  programme: Programme | undefined;
  templates: Template[];
  pick: NextSessionPick;
  /** The day the Start button starts: the pick, or the day after a rest slot. */
  template: Template | undefined;
  /** The rotation slot that day sits in, stamped onto the session. */
  slotIndex: number | undefined;
  /** Rotation slot of each day, so an override keeps walking the rotation. */
  slotByTemplate: Record<string, number>;
  exercises: Exercise[];
  lastSets: Record<string, SetLog[] | undefined>;
  active: ActiveInfo | undefined;
  last: LastInfo | undefined;
  /** Days since the most recent completed *lower* day, if there is one. */
  lowerDaysAgo: number | undefined;
  /** Days since the last export. `undefined` means it has never happened. */
  backupDays: number | undefined;
}

function daysAgoLabel(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/** A backup older than this is worth one quiet line. Nothing sooner. */
const BACKUP_STALE_DAYS = 14;

/** "3 weeks ago" / "5 months ago" — only ever called past the 14-day mark. */
function backupAgeLabel(days: number): string {
  if (days < BACKUP_STALE_DAYS) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months >= 12) return 'over a year ago';
  if (months >= 2) return `${months} months ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} weeks ago`;
}

/**
 * "Rest day 2 of 3" when the rotation actually holds a run of rest slots, and
 * a bare "Rest day" when it does not — which is what a session already logged
 * today produces, since the next training day belongs to tomorrow.
 */
function restLabel(day: number, total: number): string {
  if (total < 1) return 'Rest day';
  if (total === 1) return 'Rest day';
  return `Rest day ${day} of ${total}`;
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
    const [programme, templates, allTemplates, active, completed, settings] =
      await Promise.all([
        getActiveProgramme().catch(() => undefined),
        listTemplates(),
        // Days of every programme, so a session logged under one you are not
        // running still counts for the clash rule.
        listAllTemplates(),
        getActiveSession(),
        listSessions(false),
        readSettings(),
      ]);
    const lastCompleted = completed[0];

    const pick = pickNextSession(programme, allTemplates, completed, now);
    const targetId = pick.kind === 'train' ? pick.templateId : pick.nextTemplateId;
    const targetSlot = pick.kind === 'train' ? pick.slotIndex : pick.nextSlotIndex;
    const exercises = targetId ? await listExercises(targetId) : [];

    const slotByTemplate: Record<string, number> = {};
    (programme?.rotation ?? []).forEach((slot, index) => {
      if ('rest' in slot) return;
      if (slotByTemplate[slot.templateId] === undefined) {
        slotByTemplate[slot.templateId] = index;
      }
    });

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
        template: allTemplates.find((t) => t.id === active.templateId),
        loggedSets: detail?.sets.length ?? 0,
      };
    }

    const lowerSession = completed.find((s) => {
      const day = allTemplates.find((t) => t.id === s.templateId);
      return day ? isLowerDay(day) : false;
    });

    return {
      programme,
      templates,
      pick,
      template: targetId ? allTemplates.find((t) => t.id === targetId) : undefined,
      slotIndex: targetSlot,
      slotByTemplate,
      exercises,
      lastSets,
      active: activeInfo,
      last: lastCompleted
        ? {
            session: lastCompleted,
            template: allTemplates.find((t) => t.id === lastCompleted.templateId),
            daysAgo: calendarDaysAgo(lastCompleted.finishedAt ?? lastCompleted.startedAt, now),
          }
        : undefined,
      lowerDaysAgo: lowerSession
        ? calendarDaysAgo(lowerSession.finishedAt ?? lowerSession.startedAt, now)
        : undefined,
      backupDays:
        settings?.lastExportAt === undefined
          ? undefined
          : calendarDaysAgo(settings.lastExportAt, now),
    };
  }, []);

  async function start(templateId: string, slotIndex?: number): Promise<void> {
    if (starting) return;
    setStarting(true);
    try {
      const session = await startSession(templateId, { slotIndex });
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
  const rest = pick.kind === 'rest' ? pick : undefined;
  const resting = rest !== undefined;
  const name = template?.name ?? 'Next session';
  /** A lower day trained today or yesterday is the thing we warn about. */
  const lowerRecent = data.lowerDaysAgo !== undefined && data.lowerDaysAgo <= 1;

  /**
   * The data lives in this browser and nowhere else. One muted line when the
   * last export is old (or never happened), and nothing at all when it is not.
   */
  const backupDays = data.backupDays;
  const backupStale = backupDays === undefined || backupDays >= BACKUP_STALE_DAYS;

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
          <div className="text-[11px] tracking-wide text-muted uppercase">
            {resting ? 'Rest day suggested' : 'Next session'}
          </div>
          <h2 className="mt-1 text-3xl leading-tight font-bold tracking-tight">
            {rest ? restLabel(rest.restDay, rest.restTotal) : name}
          </h2>
          {rest ? (
            <p className="mt-2 text-sm text-muted">
              {template ? `Next up: ${template.name}.` : 'Nothing scheduled after this.'}
            </p>
          ) : null}
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

          {template ? (
            <Button
              full
              className="mt-4"
              disabled={starting}
              onClick={() => void start(template.id, data.slotIndex)}
            >
              {resting ? `Train anyway: ${name}` : `Start ${name}`}
            </Button>
          ) : null}
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

      {backupStale ? (
        <p className="px-4 pt-6 text-center text-xs text-muted">
          {backupDays === undefined
            ? 'No backup yet'
            : `Last backup ${backupAgeLabel(backupDays)}`}{' '}
          ·{' '}
          <Link to="/settings" className="underline underline-offset-4">
            Export
          </Link>
        </p>
      ) : null}

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Start a session">
        <ul className="flex flex-col gap-1">
          {data.templates.map((t) => {
            const warn = isLowerDay(t) && lowerRecent;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  disabled={starting}
                  onClick={() => void start(t.id, data.slotByTemplate[t.id])}
                  className={[
                    'flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left active:bg-surface-2',
                    t.id === template?.id ? 'bg-surface-2' : '',
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
                      <span className="block text-xs text-muted">{dayKindLabel(t)} day</span>
                    )}
                  </span>
                  {t.id === template?.id ? (
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
