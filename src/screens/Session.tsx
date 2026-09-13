import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, ConfirmDialog, Sheet } from '../components';
import {
  deleteSet,
  finishSession,
  getCatalogEntry,
  getExerciseHistory,
  getLastSessionSetsForExercise,
  getSessionDetail,
  getSessionSummary,
  logSet,
  updateSession,
  updateSet,
  type SessionSummary,
} from '../db/repo';
import { formatLastSession, formatNumber, formatPrescription } from '../logic/format';
import { suggestLoad } from '../logic/progression';
import { warmupSets, workingSets } from '../logic/sets';
import { isStalled } from '../logic/stall';
import { defaultIncrement, exerciseMassUnit, massLabel } from '../logic/units';
import useSettings from '../hooks/useSettings';
import useRestTimer from '../hooks/useRestTimer';
import useWakeLock from '../hooks/useWakeLock';
import PlateSheet from './session/PlateSheet';
import RestTimerBar from './session/RestTimerBar';
import SetRow from './session/SetRow';
import SummarySheet from './session/SummarySheet';
import { resolveSwipe } from './session/swipe';
import {
  nextWarmupIndex,
  sortWarmupIndices,
  warmupLoad,
  warmupRest,
} from './session/warmup';
import { notifyRestOver, playRestDoneCue, primeAudio, requestNotifyPermission } from './session/cue';
import type { Exercise, SetLog } from '../db/types';

interface Draft {
  load: number | null;
  reps: number | null;
  /** A fact the user marked on the row. Never read by progression. */
  toFailure: boolean;
}

/** Conditioning items are a single "log your time" row. */
function plannedSets(exercise: Exercise): number {
  return exercise.type === 'conditioning' ? 1 : Math.max(1, exercise.sets);
}

/** Working sets logged for an exercise — warm-ups never count towards the plan. */
function workingCount(sets: SetLog[] | undefined): number {
  return workingSets(sets ?? []).length;
}

/**
 * The logging screen: one exercise at a time, every tap written straight to
 * IndexedDB so a crash (or a closed tab) loses nothing.
 */
export function Session() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const settings = useSettings();
  useWakeLock(settings.keepAwake);

  /** Which exercise the running rest belongs to — it outlives navigation. */
  const [restLabel, setRestLabel] = useState('');
  /** Set when a rest ran out with the tab hidden, so the cue went unheard. */
  const missedCueFor = useRef<number | null>(null);

  /**
   * A hidden tab has a suspended audio context and, on phones, frozen timers,
   * so the beep is worthless there — the notification is the only cue that
   * lands. Remember the miss and replay the beep on the way back in.
   */
  const handleZero = useCallback(
    (endsAt: number) => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        missedCueFor.current = endsAt;
      }
      playRestDoneCue();
      void notifyRestOver(restLabel);
    },
    [restLabel],
  );

  const timer = useRestTimer(handleZero);
  const poll = timer.poll;

  // Coming back to the tab: catch up a rest that ran out while it was hidden.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      // Frozen intervals never reached zero — this fires onZero, now audibly.
      poll();
      // Throttled ones did, but nobody heard it. Once per rest, either way.
      if (missedCueFor.current !== null) {
        missedCueFor.current = null;
        playRestDoneCue();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [poll]);

  const detail = useLiveQuery(
    async () => (id ? ((await getSessionDetail(id)) ?? null) : null),
    [id],
  );

  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  /**
   * Warm-up rows on screen that are not (yet) in the database, per exercise.
   * The rendered list is these plus whatever warm-ups are already logged.
   */
  const [warmupRows, setWarmupRows] = useState<Record<string, number[]>>({});
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  /** Which row opened the plate calculator, by set index. */
  const [platesFor, setPlatesFor] = useState<number | null>(null);
  /** Non-null once Finish succeeded: the summary sheet owns the screen. */
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  /** `null` until the user types — the stored note shows through until then. */
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  /** Notifications are asked for once per session, on the first "done" tap. */
  const askedToNotify = useRef(false);
  const swipeStart = useRef<{ x: number; y: number; pointerId: number } | null>(null);

  const exercises = useMemo(() => detail?.exercises ?? [], [detail]);
  const safeIndex = exercises.length ? Math.min(index, exercises.length - 1) : 0;
  const exercise = exercises[safeIndex];
  const exerciseId = exercise?.id;

  /** Last session's sets for this exercise + the stall marker. */
  const info = useLiveQuery(async () => {
    if (!exerciseId || !id) return undefined;
    const [lastSets, history] = await Promise.all([
      getLastSessionSetsForExercise(exerciseId, id),
      getExerciseHistory(exerciseId),
    ]);
    return {
      lastSets,
      stalled: isStalled(history.filter((h) => h.session.id !== id).map((h) => h.sets)),
    };
  }, [exerciseId, id]);

  /** The library entry behind this exercise — only the equipment is read. */
  const catalogId = exercise?.catalogId;
  const catalog = useLiveQuery(
    async () => (catalogId ? ((await getCatalogEntry(catalogId)) ?? null) : null),
    [catalogId],
  );

  const suggestion = useMemo(
    () => (exercise ? suggestLoad(exercise, info?.lastSets) : undefined),
    [exercise, info?.lastSets],
  );

  if (detail === undefined) {
    return (
      <div className="px-4 py-10 text-sm text-muted" role="status">
        Loading session…
      </div>
    );
  }

  if (detail === null) {
    return (
      <div className="px-4 py-10">
        <p className="mb-4 text-sm text-muted">That session no longer exists.</p>
        <Button full onClick={() => navigate('/')}>
          Back to Today
        </Button>
      </div>
    );
  }

  const storedNotes = detail.session.notes ?? '';
  const notes = noteDraft ?? storedNotes;
  const showNote = noteOpen || storedNotes.length > 0;

  const loggedSets: SetLog[] = exercise ? (detail.setsByExercise[exercise.id] ?? []) : [];
  const loggedWorking = workingSets(loggedSets);
  const loggedWarmups = warmupSets(loggedSets);
  const remainingSets = exercises.reduce(
    (sum, ex) => sum + Math.max(0, plannedSets(ex) - workingCount(detail.setsByExercise[ex.id])),
    0,
  );

  /** The -/+ step for this exercise's load, in its own denomination. */
  const step = exercise
    ? exercise.increment || defaultIncrement(exercise.unit, exerciseMassUnit(exercise))
    : 0;
  /** Barbell lifts loaded as a total are the only ones with plates to work out. */
  const hasPlates = catalog?.equipment === 'barbell' && exercise?.unit === 'kg_total';

  const warmupIndices = exercise
    ? sortWarmupIndices([
        ...loggedWarmups.map((s) => s.setIndex),
        ...(warmupRows[exercise.id] ?? []),
      ])
    : [];

  function keyFor(setIndex: number): string {
    return `${exerciseId ?? '?'}:${setIndex}`;
  }

  /**
   * What the fields should show: an in-progress edit wins, then whatever is
   * stored for that set, then the previous logged set of this exercise
   * (carry-forward), and finally the progression suggestion. Warm-ups and
   * working sets never read each other: a warm-up pre-fills at half the
   * working suggestion and carries nothing forward.
   */
  function valuesFor(setIndex: number): Draft & { stored?: SetLog } {
    const warmup = setIndex < 0;
    const pool = warmup ? loggedWarmups : loggedWorking;
    const stored = pool.find((s) => s.setIndex === setIndex);
    const draft = drafts[keyFor(setIndex)];
    if (draft) return { ...draft, stored };
    if (stored) {
      return {
        load: stored.load,
        reps: stored.reps,
        toFailure: stored.toFailure === true,
        stored,
      };
    }

    const suggestedLoad = suggestion && suggestion.load > 0 ? suggestion.load : null;
    const suggestedReps = suggestion && suggestion.reps > 0 ? suggestion.reps : null;

    if (warmup) {
      return { load: warmupLoad(suggestedLoad, step), reps: suggestedReps, toFailure: false };
    }

    const prior = pool
      .filter((s) => s.setIndex < setIndex)
      .sort((a, b) => a.setIndex - b.setIndex)
      .pop();
    if (prior) return { load: prior.load, reps: prior.reps, toFailure: false };

    return { load: suggestedLoad, reps: suggestedReps, toFailure: false };
  }

  function patchDraft(setIndex: number, patch: Partial<Draft>): void {
    const current = valuesFor(setIndex);
    setDrafts((prev) => ({
      ...prev,
      [keyFor(setIndex)]: {
        load: current.load,
        reps: current.reps,
        toFailure: current.toFailure,
        ...patch,
      },
    }));
  }

  function forgetDraft(setIndex: number): void {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[keyFor(setIndex)];
      return next;
    });
  }

  async function handleDone(setIndex: number): Promise<void> {
    if (!id || !exercise) return;
    // Must happen synchronously inside the tap so the beep is unlocked.
    primeAudio();
    // Same reason: permission prompts are only allowed from a user gesture.
    if (!askedToNotify.current) {
      askedToNotify.current = true;
      requestNotifyPermission();
    }

    const warmup = setIndex < 0;
    const values = valuesFor(setIndex);
    const reps = values.reps ?? 0;
    if (reps <= 0) return;

    // `logSet` rebuilds the row, so the facts have to be re-passed every time.
    await logSet({
      sessionId: id,
      exerciseId: exercise.id,
      setIndex,
      load: values.load ?? 0,
      reps,
      ...(warmup ? { kind: 'warmup' as const } : {}),
      ...(values.toFailure ? { toFailure: true } : {}),
    });

    forgetDraft(setIndex);

    if (exercise.type !== 'conditioning') {
      const rest = exercise.type === 'primary' ? settings.restPrimary : settings.restAccessory;
      setRestLabel(exercise.name);
      timer.start(warmup ? warmupRest(rest) : rest);
    }
  }

  async function handleUndo(setIndex: number): Promise<void> {
    const stored = valuesFor(setIndex).stored;
    if (!stored) return;
    // Keep the numbers on screen so the fields do not jump back to a suggestion.
    setDrafts((prev) => ({
      ...prev,
      [keyFor(setIndex)]: {
        load: stored.load,
        reps: stored.reps,
        toFailure: stored.toFailure === true,
      },
    }));
    await deleteSet(stored.id);
  }

  /** Marks (or unmarks) the row. A logged set is patched in place, nothing else. */
  async function toggleFailure(setIndex: number): Promise<void> {
    const values = valuesFor(setIndex);
    const next = !values.toFailure;
    patchDraft(setIndex, { toFailure: next });
    if (values.stored) await updateSet(values.stored.id, { toFailure: next });
  }

  function addWarmup(): void {
    if (!exercise) return;
    const key = exercise.id;
    const used = [...loggedWarmups.map((s) => s.setIndex), ...(warmupRows[key] ?? [])];
    const next = nextWarmupIndex(used);
    setWarmupRows((prev) => ({ ...prev, [key]: [...(prev[key] ?? []), next] }));
  }

  async function removeWarmup(setIndex: number): Promise<void> {
    if (!exercise) return;
    const key = exercise.id;
    const stored = loggedWarmups.find((s) => s.setIndex === setIndex);
    setWarmupRows((prev) => ({
      ...prev,
      [key]: (prev[key] ?? []).filter((i) => i !== setIndex),
    }));
    forgetDraft(setIndex);
    if (stored) await deleteSet(stored.id);
  }

  function goTo(next: number): void {
    if (!exercises.length) return;
    const clamped = Math.max(0, Math.min(exercises.length - 1, next));
    if (clamped === safeIndex) return;
    setIndex(clamped);
    window.scrollTo({ top: 0 });
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    const target = event.target as HTMLElement | null;
    // Never hijack a drag that started on a control or a text field.
    if (target?.closest('input, textarea, button, a, select')) {
      swipeStart.current = null;
      return;
    }
    swipeStart.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || start.pointerId !== event.pointerId) return;
    const swipe = resolveSwipe(event.clientX - start.x, event.clientY - start.y);
    if (swipe === 'next') goTo(safeIndex + 1);
    else if (swipe === 'prev') goTo(safeIndex - 1);
  }

  async function saveNotes(): Promise<void> {
    if (!id) return;
    await updateSession(id, { notes: notes.trim() });
  }

  function requestFinish(): void {
    setOverviewOpen(false);
    if (remainingSets > 0) setFinishOpen(true);
    else void doFinish();
  }

  async function doFinish(): Promise<void> {
    setFinishOpen(false);
    if (!id) return;
    const trimmed = notes.trim();
    await finishSession(id, trimmed ? trimmed : undefined);
    const result = await getSessionSummary(id);
    if (result) setSummary(result);
    else navigate('/');
  }

  const title = detail.template?.name ?? 'Session';

  if (!exercise) {
    return (
      <div className="px-4 py-10">
        <p className="mb-4 text-sm text-muted">
          {title} has no exercises yet. Add some on the Programme tab.
        </p>
        <Button full onClick={() => navigate('/')}>
          Back to Today
        </Button>
      </div>
    );
  }

  const rowCount = Math.max(plannedSets(exercise), loggedWorking.length);
  const isLast = safeIndex === exercises.length - 1;
  const isConditioning = exercise.type === 'conditioning';

  return (
    <div>
      {/* Own header rather than PageHeader: exercise names are long and the
          shared one truncates them to a single line. */}
      <header className="pt-safe sticky top-0 z-20 bg-bg/90 backdrop-blur-sm">
        <div className="flex items-start gap-2 px-2 pt-3 pb-2">
          <button
            type="button"
            onClick={() => navigate('/')}
            aria-label="Exit session"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl text-muted active:bg-surface-2"
          >
            ←
          </button>

          <div className="min-w-0 flex-1 pt-0.5">
            <div className="text-[11px] tracking-wide text-muted uppercase">
              {safeIndex + 1} / {exercises.length} · {title}
            </div>
            <h1 className="text-xl leading-tight font-bold tracking-tight">{exercise.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
              <span>{formatPrescription(exercise)}</span>
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] tracking-wide uppercase">
                {exercise.type}
              </span>
              {info?.stalled ? (
                <span className="rounded bg-danger/15 px-1.5 py-0.5 text-[10px] tracking-wide text-danger uppercase">
                  stalled
                </span>
              ) : null}
            </div>
            <div className="text-xs text-muted">{formatLastSession(exercise, info?.lastSets)}</div>
          </div>

          <button
            type="button"
            onClick={() => setOverviewOpen(true)}
            aria-label="Exercise overview"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-lg text-muted active:bg-surface-2"
          >
            ☰
          </button>
        </div>
      </header>

      <div
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          swipeStart.current = null;
        }}
        className={timer.endsAt === null ? 'px-4 pb-32' : 'pb-60 px-4'}
      >
        {/* Step dots — filled once every planned set of that exercise is in. */}
        <div className="mt-5 mb-4 flex flex-wrap items-center justify-center gap-1.5">
          {exercises.map((ex, i) => {
            const complete = workingCount(detail.setsByExercise[ex.id]) >= plannedSets(ex);
            const current = i === safeIndex;
            return (
              <button
                key={ex.id}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Go to ${ex.name}`}
                aria-current={current ? 'step' : undefined}
                className={[
                  // The visible dot stays small; a pseudo-element gives it a
                  // 44 px-tall hit area without pushing the row apart.
                  "relative h-2.5 rounded-full transition-all before:absolute before:-inset-x-[3px]",
                  "before:-inset-y-[17px] before:content-['']",
                  current ? 'w-6 bg-accent' : complete ? 'w-2.5 bg-accent/50' : 'w-2.5 bg-border',
                ].join(' ')}
              />
            );
          })}
        </div>

        {suggestion?.progressed ? (
          <div className="mb-3 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-sm font-medium text-accent">
            ▲ +{formatNumber(exercise.increment)} {massLabel(exerciseMassUnit(exercise))} suggested
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          {isConditioning
            ? null
            : warmupIndices.map((setIndex) => {
                const values = valuesFor(setIndex);
                const stored = values.stored;
                const dirty =
                  stored !== undefined &&
                  (stored.load !== (values.load ?? 0) || stored.reps !== (values.reps ?? 0));
                return (
                  <SetRow
                    key={`${exercise.id}:${setIndex}`}
                    exercise={exercise}
                    setIndex={setIndex}
                    load={values.load}
                    reps={values.reps}
                    done={stored !== undefined}
                    dirty={dirty}
                    warmup
                    onLoadChange={(load) => patchDraft(setIndex, { load })}
                    onRepsChange={(reps) => patchDraft(setIndex, { reps })}
                    onDone={() => void handleDone(setIndex)}
                    onUndo={() => void handleUndo(setIndex)}
                    onRemove={() => void removeWarmup(setIndex)}
                    {...(hasPlates ? { onPlates: () => setPlatesFor(setIndex) } : {})}
                  />
                );
              })}

          {isConditioning ? null : (
            <button
              type="button"
              onClick={addWarmup}
              className="min-h-11 self-start text-sm text-muted underline underline-offset-4"
            >
              + Warm-up set
            </button>
          )}

          {Array.from({ length: rowCount }, (_, setIndex) => {
            const values = valuesFor(setIndex);
            const stored = values.stored;
            const dirty =
              stored !== undefined &&
              (stored.load !== (values.load ?? 0) || stored.reps !== (values.reps ?? 0));
            return (
              <SetRow
                key={`${exercise.id}:${setIndex}`}
                exercise={exercise}
                setIndex={setIndex}
                load={values.load}
                reps={values.reps}
                done={stored !== undefined}
                dirty={dirty}
                toFailure={values.toFailure}
                hint={setIndex === 0 ? suggestion?.reason : undefined}
                onLoadChange={(load) => patchDraft(setIndex, { load })}
                onRepsChange={(reps) => patchDraft(setIndex, { reps })}
                onDone={() => void handleDone(setIndex)}
                onUndo={() => void handleUndo(setIndex)}
                {...(isConditioning
                  ? {}
                  : { onToggleFailure: () => void toggleFailure(setIndex) })}
                {...(hasPlates ? { onPlates: () => setPlatesFor(setIndex) } : {})}
              />
            );
          })}
        </div>

        <div className="mt-4">
          {showNote ? (
            <textarea
              value={notes}
              onChange={(e) => setNoteDraft(e.target.value)}
              onBlur={() => void saveNotes()}
              rows={3}
              placeholder="How did it feel?"
              aria-label="Session note"
              className="w-full rounded-2xl border border-border bg-surface p-3 text-base text-fg outline-none focus:border-accent"
            />
          ) : (
            <button
              type="button"
              onClick={() => setNoteOpen(true)}
              className="min-h-11 text-sm text-muted underline underline-offset-4"
            >
              Add note
            </button>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted">Swipe left or right to change exercise.</p>
      </div>

      {/* Rest timer + prev/next live in the thumb zone; no tab bar on this route. */}
      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md">
        <RestTimerBar timer={timer} label={restLabel ? `Rest · ${restLabel}` : 'Rest'} />
        <div className="pb-safe flex gap-2 border-t border-border/70 bg-surface/95 px-4 pt-2 backdrop-blur">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => goTo(safeIndex - 1)}
            disabled={safeIndex === 0}
          >
            ← Prev
          </Button>
          {isLast ? (
            <Button className="flex-1" onClick={requestFinish}>
              Finish session
            </Button>
          ) : (
            <Button variant="secondary" className="flex-1" onClick={() => goTo(safeIndex + 1)}>
              Next →
            </Button>
          )}
        </div>
      </div>

      <Sheet
        open={overviewOpen}
        onClose={() => setOverviewOpen(false)}
        title={title}
        footer={
          <Button full onClick={requestFinish}>
            Finish session
          </Button>
        }
      >
        <ul className="flex flex-col gap-1">
          {exercises.map((ex, i) => {
            const done = workingCount(detail.setsByExercise[ex.id]);
            const planned = plannedSets(ex);
            return (
              <li key={ex.id}>
                <button
                  type="button"
                  onClick={() => {
                    goTo(i);
                    setOverviewOpen(false);
                  }}
                  className={[
                    'flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left active:bg-surface-2',
                    i === safeIndex ? 'bg-surface-2' : '',
                  ].join(' ')}
                >
                  <span className="w-5 text-sm tabular-nums text-muted">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base">{ex.name}</span>
                    <span className="block text-xs text-muted">{formatPrescription(ex)}</span>
                  </span>
                  <span
                    className={[
                      'shrink-0 text-xs tabular-nums',
                      done >= planned ? 'text-accent' : 'text-muted',
                    ].join(' ')}
                  >
                    {done}/{planned}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Sheet>

      <PlateSheet
        open={platesFor !== null}
        onClose={() => setPlatesFor(null)}
        exercise={exercise}
        load={platesFor === null ? null : valuesFor(platesFor).load}
        barWeight={settings.barWeight}
        plates={settings.plates}
      />

      <ConfirmDialog
        open={finishOpen}
        title={`${remainingSets} set${remainingSets === 1 ? '' : 's'} not logged`}
        message="Finish the session anyway? What you logged is already saved."
        confirmLabel="Finish anyway"
        destructive={false}
        onConfirm={() => void doFinish()}
        onCancel={() => setFinishOpen(false)}
      />

      {summary ? <SummarySheet summary={summary} onDone={() => navigate('/')} /> : null}
    </div>
  );
}

export default Session;
