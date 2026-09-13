import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, Card, ConfirmDialog, PageHeader, Sheet } from '../components';
import {
  deleteSession,
  getSessionDetail,
  listAllSetLogs,
  listAllTemplates,
  listExercises,
  listProgrammes,
  listSessions,
  listTemplates,
  updateSession,
} from '../db/repo';
import type { Exercise, Session, SetLog } from '../db/types';
import { formatDate, formatSetSummary, formatVolumeKg } from '../logic/format';
import { setCount, totalVolumeKg } from '../logic/volume';
import { BodyweightSection } from './history/Bodyweight';
import EditSetSheet from './history/EditSetSheet';
import { MusclesSection } from './history/Muscles';
import { RecordsSection } from './history/Records';
import { formatSetLine, orderedSetLines, setLineLabel } from './history/setLine';

type Segment = 'sessions' | 'bodyweight' | 'muscles' | 'records';

/**
 * History: completed sessions, a jump list of exercises, the weight log, the
 * muscle report and your records. Four tabs have to fit a 375 px phone, so
 * bodyweight goes by "Weight" up here.
 */
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
              ['bodyweight', 'Weight'],
              ['muscles', 'Muscles'],
              ['records', 'Records'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={segment === value}
              onClick={() => setSegment(value)}
              className={[
                'min-h-11 flex-1 rounded-lg px-1 text-sm font-medium transition-colors',
                segment === value ? 'bg-surface-2 text-fg' : 'text-muted',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {segment === 'sessions' ? (
        <SessionsSection />
      ) : segment === 'bodyweight' ? (
        <BodyweightSection />
      ) : segment === 'muscles' ? (
        <MusclesSection />
      ) : (
        <RecordsSection />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ sessions */

interface SessionRow {
  session: Session;
  templateName: string;
  /** Working sets only, so the count and the volume beside it agree. */
  setCount: number;
  /** Working-set volume in kilograms — lb sets converted, so the total adds up. */
  volumeKg: number;
}

function SessionsSection() {
  const rows = useLiveQuery(async () => {
    const [sessions, templates, sets] = await Promise.all([
      listSessions(false),
      // Every day, whatever programme it belongs to and whether or not it is
      // archived: a session started before snapshots existed still has to
      // resolve its name from somewhere.
      listAllTemplates(),
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
        // The snapshot wins: a renamed or deleted day never rewrites history.
        templateName:
          session.templateName ?? nameById.get(session.templateId) ?? session.templateId,
        setCount: setCount(own),
        volumeKg: totalVolumeKg(own),
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
                        {row.setCount === 1 ? '' : 's'} · {formatVolume(row.volumeKg)}
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

interface EditTarget {
  exercise: Exercise;
  set: SetLog;
  /** "set 3" / "warm-up 1" — what the edit sheet calls this row. */
  label: string;
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
  const [openExercise, setOpenExercise] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);

  if (!detail) {
    return <div className="border-t border-border/60 px-4 py-3 text-sm text-muted">Loading…</div>;
  }

  const logged = detail.exercises.filter((e) => detail.setsByExercise[e.id]?.length);
  const notes = detail.session.notes ?? '';

  return (
    <div className="border-t border-border/60 px-4 py-3">
      {logged.length ? (
        <ul className="divide-y divide-border/50">
          {logged.map((exercise) => {
            const sets = detail.setsByExercise[exercise.id] ?? [];
            const open = openExercise === exercise.id;
            return (
              <li key={exercise.id}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenExercise((id) => (id === exercise.id ? null : exercise.id))}
                  className="flex min-h-11 w-full items-center gap-3 py-1.5 text-left active:bg-surface-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">{exercise.name}</span>
                  <span className="shrink-0 text-sm tabular-nums text-muted">
                    {formatSetSummary(exercise, sets)}
                  </span>
                  <Chevron open={open} />
                </button>

                {open ? (
                  <div className="pb-2">
                    <ul>
                      {orderedSetLines(sets).map((line) => (
                        <li
                          key={line.set.id}
                          className={[
                            'flex items-center gap-3 text-sm',
                            line.warmup ? 'text-muted/70' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          <span className="w-14 shrink-0 text-muted">
                            {line.warmup ? 'W' : `Set ${line.index}`}
                          </span>
                          <span className="min-w-0 flex-1 truncate tabular-nums">
                            {formatSetLine(exercise, line.set)}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setEditing({
                                exercise,
                                set: line.set,
                                label: setLineLabel(line),
                              })
                            }
                            className="min-h-11 shrink-0 rounded-lg px-3 text-sm text-accent active:bg-surface-2"
                          >
                            Edit
                          </button>
                        </li>
                      ))}
                    </ul>
                    <Link
                      to={`/history/${exercise.id}`}
                      className="mt-1 inline-flex min-h-11 items-center text-sm text-accent underline-offset-2 active:underline"
                    >
                      View all sessions →
                    </Link>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted">No sets were logged in this session.</p>
      )}

      {notes ? (
        <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-sm whitespace-pre-wrap text-muted">
          {notes}
        </p>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => setNoteOpen(true)}>
          {notes ? 'Edit note' : 'Add note'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
          Delete session
        </Button>
      </div>

      {editing ? (
        <EditSetSheet
          key={editing.set.id}
          set={editing.set}
          exercise={editing.exercise}
          setLabel={editing.label}
          onClose={() => setEditing(null)}
        />
      ) : null}

      <NoteSheet
        open={noteOpen}
        notes={notes}
        onClose={() => setNoteOpen(false)}
        onSave={(text) => void updateSession(sessionId, { notes: text || undefined })}
      />

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

/** Edit the free-text note on a finished session. */
function NoteSheet({
  open,
  notes,
  onClose,
  onSave,
}: {
  open: boolean;
  notes: string;
  onClose: () => void;
  onSave: (text: string) => void;
}) {
  const [draft, setDraft] = useState(notes);
  const [lastOpen, setLastOpen] = useState(open);
  // Re-seed the textarea every time the sheet is opened.
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setDraft(notes);
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Session note"
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" full onClick={onClose}>
            Cancel
          </Button>
          <Button
            full
            onClick={() => {
              onSave(draft.trim());
              onClose();
            }}
          >
            Save
          </Button>
        </div>
      }
    >
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
        placeholder="How did it feel?"
        aria-label="Session note"
        className="w-full rounded-2xl border border-border bg-surface-2 p-3 text-base text-fg outline-none focus:border-accent"
      />
    </Sheet>
  );
}

/* ----------------------------------------------------------- exercise index */

interface IndexGroup {
  key: string;
  label: string;
  exercises: Exercise[];
}

/**
 * Every exercise, grouped by day — a chart is one tap away without expanding.
 *
 * The active programme's days come first, one group each, then a collapsed
 * "Other programmes" block with a group per saved programme you are not
 * running, so their charts stay reachable. Archived days are left out
 * deliberately: their exercises are still one tap away from a session row.
 */
function ExerciseIndex({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [othersOpen, setOthersOpen] = useState(false);

  const index = useLiveQuery(async (): Promise<{ days: IndexGroup[]; others: IndexGroup[] }> => {
    const [programmes, templates, allTemplates] = await Promise.all([
      listProgrammes(),
      listTemplates(),
      listAllTemplates(false),
    ]);
    const byTemplate = new Map<string, Exercise[]>(
      await Promise.all(
        allTemplates.map(
          async (t): Promise<[string, Exercise[]]> => [t.id, await listExercises(t.id)],
        ),
      ),
    );

    const days: IndexGroup[] = templates.map((template) => ({
      key: template.id,
      label: template.name,
      exercises: byTemplate.get(template.id) ?? [],
    }));

    const activeId = templates[0]?.programmeId ?? programmes.find((p) => p.active)?.id;
    const others: IndexGroup[] = programmes
      .filter((p) => p.id !== activeId)
      .map((programme) => ({
        key: programme.id,
        label: programme.name,
        exercises: allTemplates
          .filter((t) => t.programmeId === programme.id)
          .flatMap((t) => byTemplate.get(t.id) ?? []),
      }))
      .filter((group) => group.exercises.length > 0);

    return { days, others };
  }, []);

  const others = index?.others ?? [];

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
          {(index?.days ?? []).map((group) => (
            <IndexSection key={group.key} group={group} />
          ))}

          {others.length ? (
            <div>
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
              {othersOpen ? (
                <div className="mt-2 space-y-4">
                  {others.map((group) => (
                    <IndexSection key={group.key} group={group} />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** One heading and its list of exercises, each linking to its chart. */
function IndexSection({ group }: { group: IndexGroup }) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">{group.label}</h3>
      <Card flush>
        <ul className="divide-y divide-border/60">
          {group.exercises.map((exercise) => (
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
          {group.exercises.length === 0 ? (
            <li className="px-4 py-2 text-sm text-muted">No exercises yet.</li>
          ) : null}
        </ul>
      </Card>
    </div>
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

/** Volume is a big number — thousands separators, no decimals. Always kg. */
function formatVolume(kg: number): string {
  return kg <= 0 ? '—' : formatVolumeKg(kg);
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
