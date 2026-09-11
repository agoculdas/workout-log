import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Rest timer.
 *
 * The timer stores the *end timestamp*, never a countdown counter, so a
 * backgrounded tab (where intervals are throttled or paused) still shows the
 * right number the moment it comes back: every tick recomputes from
 * `Date.now()`.
 *
 * The state machine lives in `createRestTimer` — a plain, framework-free
 * factory — so it can be tested with fake timers without a DOM.
 */

/** Recompute cadence. 250 ms keeps the seconds digit honest without churn. */
export const TICK_MS = 250;

/** How long the "rest is over" bar stays on screen before hiding itself. */
export const AUTO_DISMISS_MS = 5000;

export interface RestTimerState {
  /** Epoch ms the rest ends at, or `null` when no timer is on screen. */
  endsAt: number | null;
  /** Seconds the current rest was started with (0 when idle). */
  duration: number;
  /** Whole seconds left, rounded up. 0 once the rest is over. */
  remaining: number;
  /** True while there is still time left. */
  running: boolean;
  /** 0 → just started, 1 → finished. Drives the progress bar. */
  progress: number;
}

export const IDLE_REST_TIMER: RestTimerState = {
  endsAt: null,
  duration: 0,
  remaining: 0,
  running: false,
  progress: 0,
};

/** Whole seconds left until `endsAt`, rounded up and clamped at 0. */
export function remainingSeconds(endsAt: number | null, now: number): number {
  if (endsAt === null) return 0;
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

/** Elapsed fraction of a rest of `duration` seconds ending at `endsAt`. */
export function timerProgress(
  endsAt: number | null,
  duration: number,
  now: number,
): number {
  if (endsAt === null || duration <= 0) return 0;
  const total = duration * 1000;
  const left = Math.min(total, Math.max(0, endsAt - now));
  return 1 - left / total;
}

/** 90 -> "1:30", 5 -> "0:05", 600 -> "10:00". */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

export interface RestTimerOptions {
  /** Fired once, the first tick at or after zero. Vibrate/beep hangs off this. */
  onZero?: () => void;
  /** Override the tick cadence (tests). */
  tickMs?: number;
  /** Override the clock (tests). */
  now?: () => number;
}

export interface RestTimerCore {
  getState: () => RestTimerState;
  subscribe: (listener: () => void) => () => void;
  /** Start (or restart) a rest of `seconds`. Ignored for non-positive input. */
  start: (seconds: number) => void;
  /** Add time. Restarts from now when the rest already finished. */
  extend: (seconds: number) => void;
  /** Clear the timer and hide the bar. */
  skip: () => void;
  /** Swap the zero callback (the React binding keeps this fresh). */
  setOnZero: (fn: (() => void) | undefined) => void;
}

/**
 * The timer state machine. The interval only runs while somebody is
 * subscribed *and* a rest is in flight, so it cleans up after itself and
 * survives React StrictMode's mount/unmount/remount without going dead.
 */
export function createRestTimer(options: RestTimerOptions = {}): RestTimerCore {
  let onZero = options.onZero;
  const tickMs = options.tickMs ?? TICK_MS;
  const clock = options.now ?? (() => Date.now());
  const listeners = new Set<() => void>();

  let endsAt: number | null = null;
  let duration = 0;
  /** The `endsAt` value we already fired `onZero` for. */
  let firedFor: number | null = null;
  let handle: ReturnType<typeof setInterval> | null = null;
  let state: RestTimerState = IDLE_REST_TIMER;

  function snapshot(): RestTimerState {
    if (endsAt === null) return IDLE_REST_TIMER;
    const now = clock();
    const remaining = remainingSeconds(endsAt, now);
    return {
      endsAt,
      duration,
      remaining,
      running: remaining > 0,
      progress: timerProgress(endsAt, duration, now),
    };
  }

  function sync(): void {
    const next = snapshot();
    const changed =
      next.endsAt !== state.endsAt ||
      next.duration !== state.duration ||
      next.remaining !== state.remaining ||
      next.progress !== state.progress;
    if (!changed) return;
    state = next;
    listeners.forEach((listener) => listener());
  }

  function stopInterval(): void {
    if (handle === null) return;
    clearInterval(handle);
    handle = null;
  }

  function ensureInterval(): void {
    if (handle !== null || endsAt === null || listeners.size === 0) return;
    handle = setInterval(tick, tickMs);
  }

  function tick(): void {
    if (endsAt === null) {
      stopInterval();
      return;
    }
    const now = clock();
    if (now >= endsAt && firedFor !== endsAt) {
      firedFor = endsAt;
      onZero?.();
    }
    if (now >= endsAt + AUTO_DISMISS_MS) {
      endsAt = null;
      duration = 0;
    }
    sync();
    if (endsAt === null) stopInterval();
  }

  return {
    getState: () => state,
    setOnZero(fn) {
      onZero = fn;
    },
    subscribe(listener) {
      listeners.add(listener);
      ensureInterval();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stopInterval();
      };
    },
    start(seconds) {
      if (!(seconds > 0)) return;
      endsAt = clock() + seconds * 1000;
      duration = seconds;
      firedFor = null;
      sync();
      ensureInterval();
    },
    extend(seconds) {
      if (endsAt === null || !(seconds > 0)) return;
      const now = clock();
      if (now >= endsAt) {
        endsAt = now + seconds * 1000;
        duration = seconds;
      } else {
        endsAt += seconds * 1000;
        duration += seconds;
      }
      firedFor = null;
      sync();
      ensureInterval();
    },
    skip() {
      endsAt = null;
      duration = 0;
      firedFor = null;
      stopInterval();
      sync();
    },
  };
}

export interface RestTimerHandle extends RestTimerState {
  start: (seconds: number) => void;
  extend: (seconds: number) => void;
  skip: () => void;
}

/**
 * React binding for `createRestTimer`. One timer per mounted component; it
 * keeps running while the component lives, so moving between exercises in a
 * session does not disturb it.
 *
 * @param onZero called when the countdown reaches zero (vibrate + beep).
 */
export function useRestTimer(onZero?: () => void): RestTimerHandle {
  // Lazy initialiser: exactly one timer for the lifetime of the component.
  const [core] = useState<RestTimerCore>(() => createRestTimer());

  useEffect(() => {
    core.setOnZero(onZero);
  }, [core, onZero]);

  const state = useSyncExternalStore(core.subscribe, core.getState, core.getState);

  return {
    ...state,
    start: core.start,
    extend: core.extend,
    skip: core.skip,
  };
}

export default useRestTimer;
