import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, Card, Chip, ConfirmDialog, PageHeader, Sheet } from '../components';
import {
  deleteSession,
  getActiveSession,
  getLastSessionSetsForExercise,
  getSessionDetail,
  listAllTemplates,
  listExercises,
  listProgrammes,
  listSessions,
  listTemplates,
  readActiveProgramme,
  readSettings,
  startSession,
} from '../db/repo';
import { calendarDaysAgo, pickNextSession, type NextSessionPick } from '../logic/nextSession';
import { dayKindLabel, tagsClash } from '../logic/days';
import { formatDate, formatLastSession, formatPrescription } from '../logic/format';
import { workingSets } from '../logic/sets';
import type { Exercise, Programme, Session, SetLog, SplitTag, Template } from '../db/types';

interface ActiveInfo {
  session: Session;
  /** The session's own snapshot of the day name, else the live row's. */
  name: string;
  loggedSets: number;
}

interface LastInfo {
  name: string;
  daysAgo: number;
}

/**
 * The most recent completed session, when it is recent enough to matter to the
 * clash rule — the picker explains itself with the same 24 h window
 * `pickNextSession` uses.
 */
interface ClashSource {
  /** The day trained, so the picker can say "trained today" on that row. */
  dayId: string;
  tags: SplitTag[];
  name: string;
  daysAgo: number;
}

/** One non-active programme's days, for the picker's second group. */
interface OtherProgramme {
  id: string;
  name: string;
  days: Template[];
}

interface TodayData {
  programme: Programme | undefined;
  /** How many slots the active rotation holds, for "4 of 7". */
  rotationLength: number;
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
  clash: ClashSource | undefined;
  others: OtherProgramme[];
  /** Days since the last export. `undefined` means it has never happened. */
  backupDays: number | undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;

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
 * Where in the programme this is: "Upper / Lower · 4 of 7" for a training day,
 * "Upper / Lower · rest" on a rest slot. Falls back to the plain state when
 * there is no programme, or no rotation to count against.
 */
function eyebrowText(
  pick: NextSessionPick,
  programme: Programme | undefined,
  rotationLength: number,
): string {
  if (!programme) return pick.kind === 'rest' ? 'Rest day suggested' : 'Next session';
  if (pick.slotIndex < 0 || rotationLength < 1) return programme.name;
  if (pick.kind === 'rest') return `${programme.name} · rest`;
  return `${programme.name} · ${pick.slotIndex + 1} of ${rotationLength}`;
}

/**
 * Why this day is worth a second thought, in the picker. The same-kind rule
 * `pickNextSession` applies, said out loud — and a plainer line for the day
 * you just trained, where "same kind of day as itself" would be nonsense.
 */
function clashNote(day: Template, source: ClashSource | undefined): string | undefined {
  if (!source) return undefined;
  if (day.id === source.dayId) return `Trained ${daysAgoLabel(source.daysAgo)}`;
  if (!tagsClash(day.tags, source.tags)) return undefined;
  return `Same kind of day as ${source.name}, finished ${daysAgoLabel(source.daysAgo)}`;
}

/**
 * Today: what to train next, why, and one tap to start it. Also surfaces an
 * unfinished session so a session interrupted by a closed tab is resumable.
 */
export function Today() {
  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [othersOpen, setOthersOpen] = useState(false);
  const [restExercisesOpen, setRestExercisesOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  const data = useLiveQuery(async (): Promise<TodayData> => {
    const now = Date.now();
    const [programme, templates, allTemplates, programmes, active, completed, settings] =
      await Promise.all([
        readActiveProgramme(),
        listTemplates(),
        // Days of every programme, so a session logged under one you are not
        // running still counts for the clash rule.
        listAllTemplates(),
        listProgrammes(),
        getActiveSession(),
        listSessions(false),
        readSettings(),
      ]);
    const lastCompleted = completed[0];

    // `pickNextSession` scopes its own empty-rotation fallback to the active
    // programme, so the day it names is always one of `templates` — even
    // though it is handed every programme's days for the clash rule. It
    // reports `slotIndex: -1` there, which `startSession` drops.
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
        name: detail?.templateName ?? 'Session',
        // Working sets, the same count History and the finish summary use.
        loggedSets: workingSets(detail?.sets ?? []).length,
      };
    }

    const lastEnded = lastCompleted
      ? (lastCompleted.finishedAt ?? lastCompleted.startedAt)
      : undefined;
    const lastDay = lastCompleted
      ? allTemplates.find((t) => t.id === lastCompleted.templateId)
      : undefined;

    // Days you could start that are not this programme's, grouped by the
    // programme they belong to. Archived days stay out, and archived
    // programmes never reach `listProgrammes`.
    const others: OtherProgramme[] = programmes
      .filter((p) => p.id !== programme?.id)
      .map((p) => ({
        id: p.id,
        name: p.name,
        days: allTemplates.filter((t) => !t.archived && t.programmeId === p.id),
      }))
      .filter((group) => group.days.length > 0);

    return {
      programme,
      rotationLength: programme?.rotation.length ?? 0,
      templates,
      pick,
      template: targetId ? allTemplates.find((t) => t.id === targetId) : undefined,
      slotIndex: targetSlot,
      slotByTemplate,
      exercises,
      lastSets,
      active: activeInfo,
      last:
        lastCompleted && lastEnded !== undefined
          ? {
              name: lastCompleted.templateName ?? lastDay?.name ?? 'session',
              daysAgo: calendarDaysAgo(lastEnded, now),
            }
          : undefined,
      clash:
        lastCompleted && lastDay && lastEnded !== undefined && now - lastEnded < DAY_MS
          ? {
              dayId: lastDay.id,
              tags: lastDay.tags,
              name: lastCompleted.templateName ?? lastDay.name,
              daysAgo: calendarDaysAgo(lastEnded, now),
            }
          : undefined,
      others,
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

  const { active, exercises, last, pick, programme, template } = data;
  const rest = pick.kind === 'rest' ? pick : undefined;
  const name = template?.name ?? 'Next session';
  const eyebrow = eyebrowText(pick, programme, data.rotationLength);
  /** Nothing to offer at all: an empty programme rather than a rest day. */
  const empty = !template && data.templates.length === 0;

  /**
   * The data lives in this browser and nowhere else. One muted line when the
   * last export is old (or never happened), and nothing at all when it is not.
   */
  const backupDays = data.backupDays;
  const backupStale = backupDays === undefined || backupDays >= BACKUP_STALE_DAYS;

  const exerciseList = (
    <ul className="flex flex-col divide-y divide-border/60">
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
        <li className="py-2.5 text-sm text-muted">No exercises on this day yet.</li>
      ) : null}
    </ul>
  );

  return (
    <div>
      <PageHeader title="Today" subtitle={greeting()} />

      <div className="flex flex-col gap-4 px-4 pt-1">
        {active ? (
          <Card className="border-accent/40 bg-accent/5">
            <div className="text-[11px] tracking-wide text-accent uppercase">In progress</div>
            <div className="mt-1 text-lg font-semibold">{active.name}</div>
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
          <div className="text-[11px] tracking-wide text-muted uppercase">{eyebrow}</div>

          {empty ? (
            <>
              <h2 className="mt-1 text-2xl leading-tight font-bold tracking-tight">
                No days in {programme?.name ?? 'this programme'}
              </h2>
              <p className="mt-2 text-sm text-muted">
                <Link to="/programme" className="text-accent underline underline-offset-4">
                  Add a day
                </Link>{' '}
                to start logging sessions.
              </p>
            </>
          ) : rest ? (
            <>
              <h2 className="mt-1 text-3xl leading-tight font-bold tracking-tight">
                {restLabel(rest.restDay, rest.restTotal)}
              </h2>
              <p className="mt-2 text-sm text-muted">
                {template ? `Next: ${template.name}` : 'No training day in the rotation.'}
              </p>
              {rest.reason ? <p className="mt-1 text-sm text-muted">{rest.reason}</p> : null}

              {template ? (
                <>
                  <button
                    type="button"
                    aria-expanded={restExercisesOpen}
                    onClick={() => setRestExercisesOpen((v) => !v)}
                    className="mt-1 flex min-h-11 items-center gap-2 text-sm text-muted"
                  >
                    {restExercisesOpen ? 'Hide exercises' : 'Show exercises'}
                    <Chevron open={restExercisesOpen} />
                  </button>
                  {restExercisesOpen ? exerciseList : null}
                  <Button
                    full
                    variant="secondary"
                    className="mt-4"
                    disabled={starting}
                    onClick={() => void start(template.id, data.slotIndex)}
                  >
                    Train anyway · {name}
                  </Button>
                </>
              ) : null}
            </>
          ) : (
            <>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="text-3xl leading-tight font-bold tracking-tight">{name}</h2>
                {template ? <Chip>{dayKindLabel(template)}</Chip> : null}
              </div>
              {pick.reason ? <p className="mt-2 text-sm text-muted">{pick.reason}</p> : null}
              {pick.kind === 'train' && pick.restTaken ? (
                <p className="mt-2 text-sm text-muted">
                  After {pick.restTaken} rest day{pick.restTaken === 1 ? '' : 's'}
                </p>
              ) : null}

              <div className="mt-4">{exerciseList}</div>

              {template ? (
                <Button
                  full
                  className="mt-4"
                  disabled={starting}
                  onClick={() => void start(template.id, data.slotIndex)}
                >
                  Start {name}
                </Button>
              ) : null}
            </>
          )}
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
              ? `Last: ${last.name} · ${daysAgoLabel(last.daysAgo)}`
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
          {data.templates.map((t) => (
            <li key={t.id}>
              <DayButton
                day={t}
                note={clashNote(t, data.clash)}
                suggested={t.id === template?.id}
                disabled={starting}
                onStart={() => void start(t.id, data.slotByTemplate[t.id])}
              />
            </li>
          ))}
          {data.templates.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">
              No days in this programme yet.{' '}
              <Link to="/programme" className="text-accent underline underline-offset-4">
                Add one
              </Link>
              .
            </li>
          ) : null}
        </ul>

        {data.others.length ? (
          <section className="mt-2 border-t border-border/60 pt-1">
            <button
              type="button"
              aria-expanded={othersOpen}
              onClick={() => setOthersOpen((v) => !v)}
              className="flex min-h-12 w-full items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase"
            >
              Other programmes
              <span className="flex-1 border-t border-border/60" />
              <Chevron open={othersOpen} />
            </button>
            {othersOpen
              ? data.others.map((group) => (
                  <div key={group.id} className="mt-1 mb-2">
                    <h3 className="px-3 pb-1 text-sm font-semibold">{group.name}</h3>
                    <ul className="flex flex-col gap-1">
                      {group.days.map((t) => (
                        <li key={t.id}>
                          <DayButton
                            day={t}
                            note={clashNote(t, data.clash)}
                            suggested={false}
                            disabled={starting}
                            onStart={() => void start(t.id)}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              : null}
          </section>
        ) : null}
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

/** One row of the picker: the day, what kind it is, and why it might wait. */
function DayButton({
  day,
  note,
  suggested,
  disabled,
  onStart,
}: {
  day: Template;
  note: string | undefined;
  suggested: boolean;
  disabled: boolean;
  onStart: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onStart}
      className={[
        'flex min-h-14 w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left active:bg-surface-2',
        suggested ? 'bg-surface-2' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-base">{day.name}</span>
        {suggested ? <span className="block text-xs text-accent">suggested</span> : null}
        {note ? <span className="block text-xs text-muted">{note}</span> : null}
      </span>
      <Chip className="shrink-0">{dayKindLabel(day)}</Chip>
    </button>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
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
  );
}

export default Today;
