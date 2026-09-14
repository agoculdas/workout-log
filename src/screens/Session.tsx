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
  getExercise,
  getExerciseHistory,
  getExerciseRecords,
  getLastSessionSetsForExercise,
  getSessionDetail,
  getSessionSummary,
  logSet,
  moveSessionExercise,
  setExerciseOverride,
  skipSessionExercise,
  swapSessionExercise,
  updateSession,
  updateSet,
  type SessionExercise,
  type SessionSummary,
} from '../db/repo';
import {
  formatClock,
  formatLastSession,
  formatNumber,
  formatPrescription,
} from '../logic/format';
import { exerciseScheme, suggestLoad } from '../logic/progression';
import { setBeats, type SetRecordKind } from '../logic/records';
import { warmupSets, workingSets } from '../logic/sets';
import { isStalled } from '../logic/stall';
import { defaultIncrement, exerciseMassUnit, massLabel } from '../logic/units';
import { topSetLoad } from '../logic/volume';
import useSettings from '../hooks/useSettings';
import useElapsed from '../hooks/useElapsed';
import useRestTimer from '../hooks/useRestTimer';
import useWakeLock from '../hooks/useWakeLock';
import LibraryPickerSheet from './programme/LibraryPickerSheet';
import PlateSheet from './session/PlateSheet';
import RestTimerBar from './session/RestTimerBar';
import SetRow from './session/SetRow';
import StallSheet from './session/StallSheet';
import SummarySheet from './session/SummarySheet';
import { resolveSwipe } from './session/swipe';
import {
  nextWarmupIndex,
  sortWarmupIndices,
  warmupLoad,
  warmupRest,
} from './session/warmup';
import { notifyRestOver, playRestDoneCue, primeAudio, requestNotifyPermission } from './session/cue';
import type { Exercise, ExerciseOverride, SetLog } from '../db/types';

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

/**
 * What a logged set says when it beat something: nothing at all, "PR", or
 * "PR · e1RM" when the estimated 1RM is the only record that moved. A fact on
 * the row, and the end of it — records never touch a suggestion.
 */
function recordNote(kinds: SetRecordKind[]): string | undefined {
  if (!kinds.length) return undefined;
  return kinds.length === 1 && kinds[0] === 'e1rm' ? 'PR · e1RM' : 'PR';
}

/** Working sets logged for an exercise — warm-ups never count towards the plan. */
function workingCount(sets: SetLog[] | undefined): number {
  return workingSets(sets ?? []).length;
}

/** One line of the per-exercise menu in the overview sheet. */
function PlanAction({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        'flex min-h-11 items-center rounded-lg px-3 text-left text-sm',
        disabled ? 'text-muted/40' : 'text-fg active:bg-surface-2',
      ].join(' ')}
    >
      {children}
    </button>
  );
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

  // Skipped exercises come back too: the overview lists them (dimmed, with the
  // way back), everything that counts the session filters them out below.
  const detail = useLiveQuery(
    async () => (id ? ((await getSessionDetail(id, { includeSkipped: true })) ?? null) : null),
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
  /** Which overview row has its menu open, by exercise id. */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  /** Which exercise the library picker is swapping out, for today only. */
  const [swapFor, setSwapFor] = useState<string | null>(null);
  /** Set after a swap so the pager lands on the exercise once it arrives. */
  const [focusId, setFocusId] = useState<string | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  /** The stall sheet, only ever opened by tapping the marker or the reason. */
  const [stallOpen, setStallOpen] = useState(false);
  /** Which row opened the plate calculator, by set index. */
  const [platesFor, setPlatesFor] = useState<number | null>(null);
  /** Non-null once Finish succeeded: the summary sheet owns the screen. */
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  /** `null` until the user types — the stored note shows through until then. */
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  /** Notifications are asked for once per session, on the first "done" tap. */
  const askedToNotify = useRef(false);
  const swipeStart = useRef<{ x: number; y: number; pointerId: number } | null>(null);

  /** Today's plan in order, skipped rows included. The overview sheet's list. */
  const plan = useMemo((): SessionExercise[] => detail?.exercises ?? [], [detail]);
  /** What you are actually working through: the plan minus what today dropped. */
  const exercises = useMemo(() => plan.filter((e) => !e.skipped), [plan]);
  const safeIndex = exercises.length ? Math.min(index, exercises.length - 1) : 0;
  const exercise = exercises[safeIndex];
  const exerciseId = exercise?.id;

  /**
   * Last session's sets for this exercise, the stall marker, and the records
   * as they stood *before* this session — what a set logged now has to beat.
   */
  const info = useLiveQuery(async () => {
    if (!exerciseId || !id) return undefined;
    const [lastSets, history, records] = await Promise.all([
      getLastSessionSetsForExercise(exerciseId, id),
      getExerciseHistory(exerciseId),
      getExerciseRecords(exerciseId, { excludeSessionId: id }),
    ]);
    return {
      lastSets,
      stalled: isStalled(history.filter((h) => h.session.id !== id).map((h) => h.sets)),
      records,
    };
  }, [exerciseId, id]);

  /**
   * The standing stall answer, read from the live programme row rather than
   * from the session snapshot: it is current state, not a prescription, so
   * choosing one has to land on the rows straight away.
   */
  const override = useLiveQuery(
    async () => (exerciseId ? ((await getExercise(exerciseId))?.override ?? null) : null),
    [exerciseId],
  );

  /** The library entry behind this exercise — only the equipment is read. */
  const catalogId = exercise?.catalogId;
  const catalog = useLiveQuery(
    async () => (catalogId ? ((await getCatalogEntry(catalogId)) ?? null) : null),
    [catalogId],
  );

  /**
   * The pre-fill. The best time is a *fact* handed to a conditioning row so it
   * knows what to beat; the stall override is what you chose by hand. Neither
   * is inferred from anything you logged.
   */
  const suggestion = useMemo(() => {
    if (!exercise) return undefined;
    const best = info?.records.bestTime?.value;
    const wantsTime = exerciseScheme(exercise) === 'best-time';
    return suggestLoad(exercise, info?.lastSets, {
      ...(wantsTime && best !== undefined ? { bestTime: best } : {}),
      ...(override ? { override } : {}),
    });
  }, [exercise, info?.lastSets, info?.records, override]);

  /** Heaviest working load of the last session — what a deload comes off. */
  const lastLoad = useMemo(
    () => topSetLoad(workingSets(info?.lastSets ?? [])),
    [info?.lastSets],
  );

  /** How long you have been in here. A fact in the header, nothing more. */
  const elapsedMs = useElapsed(detail?.session.startedAt, {
    running: detail?.session.finishedAt === undefined,
    ...(detail?.session.finishedAt === undefined ? {} : { until: detail.session.finishedAt }),
  });

  // A swapped-in exercise only exists once the write lands, so the pager
  // follows it by id rather than by the index it is about to take. Adjusted
  // during render (the React-sanctioned shape) rather than in an effect, so
  // the new exercise is never painted at the old index first.
  if (focusId) {
    const at = exercises.findIndex((e) => e.id === focusId);
    if (at >= 0) {
      setFocusId(null);
      setIndex(at);
    }
  }

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
      const fallback =
        exercise.type === 'primary' ? settings.restPrimary : settings.restAccessory;
      const rest =
        exercise.restOverride && exercise.restOverride > 0 ? exercise.restOverride : fallback;
      setRestLabel(exercise.name);
      timer.start(warmup ? warmupRest(rest) : rest);
    }
  }

  /**
   * Writes (or clears) the hand-picked stall answer and drops the pre-fill of
   * every row that is not logged yet, so the new numbers land straight away.
   * Logged rows are left exactly as they are.
   */
  async function chooseOverride(override: ExerciseOverride | undefined): Promise<void> {
    if (!exercise) return;
    const stored = new Set(loggedSets.map((s) => s.setIndex));
    setDrafts((prev) => {
      const next: Record<string, Draft> = {};
      for (const [key, draft] of Object.entries(prev)) {
        const at = key.lastIndexOf(':');
        const sameExercise = key.slice(0, at) === exercise.id;
        if (sameExercise && !stored.has(Number(key.slice(at + 1)))) continue;
        next[key] = draft;
      }
      return next;
    });
    await setExerciseOverride(exercise.id, override);
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

  /** Drop this exercise from today, or put it back. The programme is untouched. */
  async function toggleSkip(ex: SessionExercise): Promise<void> {
    if (!id) return;
    setMenuFor(null);
    await skipSessionExercise(id, ex.id, !ex.skipped);
  }

  /** Move one place in today's order. The menu stays open to move again. */
  async function movePlan(exerciseId: string, direction: 'earlier' | 'later'): Promise<void> {
    if (!id) return;
    await moveSessionExercise(id, exerciseId, direction);
  }

  /** Swap for a library movement, for this session only. */
  async function chooseSwap(catalogId: string): Promise<void> {
    const target = swapFor;
    if (!id || !target) return;
    setSwapFor(null);
    const replacement = await swapSessionExercise(id, target, catalogId);
    setFocusId(replacement.id);
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

  // The snapshot, not the live row: renaming or retiring the day on the
  // Programme tab must not rewrite the session you are logging.
  const title = detail.templateName;

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
              {safeIndex + 1} / {exercises.length} · {title} ·{' '}
              <span className="tabular-nums">{formatClock(elapsedMs / 1000)}</span>
            </div>
            <h1 className="text-xl leading-tight font-bold tracking-tight">{exercise.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
              <span>{formatPrescription(exercise)}</span>
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] tracking-wide uppercase">
                {exercise.type}
              </span>
              {info?.stalled ? (
                // The marker is the way in to the stall sheet, and the only
                // one — nothing about a deload is offered unprompted. The
                // pseudo-element gives the small chip a 44px hit area without
                // pushing the header row apart (same trick as the step dots).
                <button
                  type="button"
                  onClick={() => setStallOpen(true)}
                  aria-label="Stalled — what to do about it"
                  className={[
                    'relative rounded bg-danger/15 px-1.5 py-0.5 text-[10px] tracking-wide',
                    "text-danger uppercase before:absolute before:-inset-x-2 before:content-['']",
                    'before:-inset-y-[14px]',
                  ].join(' ')}
                >
                  stalled ›
                </button>
              ) : null}
            </div>
            {exercise.note ? (
              <div className="mt-0.5 text-xs text-muted">{exercise.note}</div>
            ) : null}
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

        {override ? (
          // The standing answer, and the way back out of it. It replaces the
          // reason line under the first set so the same sentence is not said
          // twice.
          <button
            type="button"
            onClick={() => setStallOpen(true)}
            className="mb-3 flex min-h-11 w-full items-center gap-1 rounded-xl border border-border bg-surface-2/50 px-3 py-2 text-left text-sm text-muted"
          >
            <span className="min-w-0 flex-1">{suggestion?.reason}</span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0 text-accent underline underline-offset-4">Change</span>
          </button>
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
            // Only a set that is actually in the database can hold a record.
            const record = stored
              ? recordNote(setBeats(exercise, info?.records ?? {}, stored))
              : undefined;
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
                hint={
                  setIndex === 0 && !override ? suggestion?.reason : undefined
                }
                {...(record ? { record } : {})}
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
          {plan.map((ex, at) => {
            const done = workingCount(detail.setsByExercise[ex.id]);
            const planned = plannedSets(ex);
            // Where it sits in what you are working through, or nowhere.
            const position = ex.skipped ? -1 : exercises.findIndex((e) => e.id === ex.id);
            const open = menuFor === ex.id;
            return (
              <li key={ex.id}>
                <div
                  className={[
                    'flex items-center gap-1 rounded-xl',
                    position === safeIndex ? 'bg-surface-2' : '',
                  ].join(' ')}
                >
                  <button
                    type="button"
                    disabled={ex.skipped}
                    onClick={() => {
                      goTo(position);
                      setOverviewOpen(false);
                    }}
                    className={[
                      'flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl px-3 text-left',
                      ex.skipped ? 'opacity-45' : 'active:bg-surface-2',
                    ].join(' ')}
                  >
                    <span className="w-5 text-sm tabular-nums text-muted">
                      {position >= 0 ? position + 1 : '·'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base">
                        {ex.name}
                        {ex.addedForToday ? (
                          <span className="text-muted"> (today only)</span>
                        ) : null}
                      </span>
                      <span className="block text-xs text-muted">{formatPrescription(ex)}</span>
                      {ex.note ? (
                        <span className="block truncate text-xs text-muted">{ex.note}</span>
                      ) : null}
                    </span>
                    <span
                      className={[
                        'shrink-0 text-xs tabular-nums',
                        !ex.skipped && done >= planned ? 'text-accent' : 'text-muted',
                      ].join(' ')}
                    >
                      {ex.skipped ? 'skipped' : `${done}/${planned}`}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Change ${ex.name} for today`}
                    aria-expanded={open}
                    onClick={() => setMenuFor(open ? null : ex.id)}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg text-muted active:bg-surface-2"
                  >
                    ⋯
                  </button>
                </div>

                {open ? (
                  <div className="mt-1 mb-1 flex flex-col rounded-xl bg-surface-2/60 p-1">
                    <PlanAction onClick={() => void toggleSkip(ex)}>
                      {ex.skipped ? 'Unskip' : 'Skip today'}
                    </PlanAction>
                    <PlanAction
                      disabled={at === 0}
                      onClick={() => void movePlan(ex.id, 'earlier')}
                    >
                      Move earlier
                    </PlanAction>
                    <PlanAction
                      disabled={at === plan.length - 1}
                      onClick={() => void movePlan(ex.id, 'later')}
                    >
                      Move later
                    </PlanAction>
                    <PlanAction
                      onClick={() => {
                        setMenuFor(null);
                        setOverviewOpen(false);
                        setSwapFor(ex.id);
                      }}
                    >
                      Swap for today…
                    </PlanAction>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Sheet>

      <LibraryPickerSheet
        open={swapFor !== null}
        title="Swap for today"
        note={
          swapFor
            ? `Only this session. The programme keeps ${
                plan.find((e) => e.id === swapFor)?.name ?? 'the original'
              }.`
            : undefined
        }
        actionLabel="Swap in"
        onChoose={(entry) => void chooseSwap(entry.id)}
        onClose={() => setSwapFor(null)}
      />

      <StallSheet
        open={stallOpen}
        onClose={() => setStallOpen(false)}
        exercise={exercise}
        lastLoad={lastLoad}
        current={override ?? undefined}
        onChoose={(override) => void chooseOverride(override)}
      />

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
