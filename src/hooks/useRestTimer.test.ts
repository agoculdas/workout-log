import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_DISMISS_MS,
  createRestTimer,
  formatClock,
  remainingSeconds,
  timerProgress,
} from './useRestTimer';

describe('remainingSeconds', () => {
  it('rounds up so the display never shows 0 while time is left', () => {
    expect(remainingSeconds(10_000, 9_001)).toBe(1);
    expect(remainingSeconds(10_000, 8_999)).toBe(2);
  });

  it('clamps at zero and treats null as idle', () => {
    expect(remainingSeconds(10_000, 50_000)).toBe(0);
    expect(remainingSeconds(null, 0)).toBe(0);
  });
});

describe('timerProgress', () => {
  it('runs 0 -> 1 across the rest', () => {
    expect(timerProgress(100_000, 100, 0)).toBe(0);
    expect(timerProgress(100_000, 100, 50_000)).toBeCloseTo(0.5);
    expect(timerProgress(100_000, 100, 100_000)).toBe(1);
    expect(timerProgress(100_000, 100, 500_000)).toBe(1);
  });

  it('is 0 when idle', () => {
    expect(timerProgress(null, 90, 0)).toBe(0);
    expect(timerProgress(1_000, 0, 0)).toBe(0);
  });
});

describe('formatClock', () => {
  it('formats mm:ss', () => {
    expect(formatClock(90)).toBe('1:30');
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(600)).toBe('10:00');
    expect(formatClock(-4)).toBe('0:00');
  });
});

describe('createRestTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function mounted(onZero?: () => void) {
    const timer = createRestTimer({ onZero });
    const unsubscribe = timer.subscribe(() => {});
    return { timer, unsubscribe };
  }

  it('is idle before it is started', () => {
    const { timer, unsubscribe } = mounted();
    expect(timer.getState()).toMatchObject({ endsAt: null, remaining: 0, running: false });
    unsubscribe();
  });

  it('counts down from the stored end timestamp', () => {
    const { timer, unsubscribe } = mounted();
    timer.start(90);
    expect(timer.getState()).toMatchObject({ endsAt: 90_000, duration: 90, remaining: 90, running: true });

    vi.advanceTimersByTime(30_000);
    expect(timer.getState().remaining).toBe(60);
    expect(timer.getState().progress).toBeCloseTo(1 / 3);
    unsubscribe();
  });

  it('recomputes from the clock after the tab was throttled', () => {
    const { timer, unsubscribe } = mounted();
    timer.start(120);
    // Clock jumps a minute without any intervening ticks firing.
    vi.setSystemTime(60_000);
    vi.advanceTimersByTime(250);
    expect(timer.getState().remaining).toBe(60);
    unsubscribe();
  });

  it('fires onZero exactly once at zero', () => {
    const onZero = vi.fn();
    const { timer, unsubscribe } = mounted(onZero);
    timer.start(2);

    vi.advanceTimersByTime(1_900);
    expect(onZero).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(onZero).toHaveBeenCalledTimes(1);
    expect(timer.getState()).toMatchObject({ remaining: 0, running: false });

    vi.advanceTimersByTime(1_000);
    expect(onZero).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('passes the endsAt it fired for to onZero', () => {
    const onZero = vi.fn();
    const { timer, unsubscribe } = mounted(onZero);
    timer.start(2);
    vi.advanceTimersByTime(2_100);
    expect(onZero).toHaveBeenCalledWith(2_000);
    unsubscribe();
  });

  it('poll() catches up a rest that ran out while the tab was frozen', () => {
    const onZero = vi.fn();
    const timer = createRestTimer({ onZero });
    const unsubscribe = timer.subscribe(() => {});
    timer.start(60);

    // Nothing ticked (hidden tab), but the wall clock moved past the end.
    unsubscribe();
    vi.setSystemTime(61_000);

    const resubscribe = timer.subscribe(() => {});
    expect(onZero).not.toHaveBeenCalled();

    const state = timer.poll();
    expect(onZero).toHaveBeenCalledTimes(1);
    expect(onZero).toHaveBeenCalledWith(60_000);
    expect(state).toMatchObject({ endsAt: 60_000, remaining: 0, running: false });

    // Still at most once per rest, however often we poll or tick.
    timer.poll();
    vi.advanceTimersByTime(1_000);
    expect(onZero).toHaveBeenCalledTimes(1);
    resubscribe();
  });

  it('hides itself a few seconds after finishing', () => {
    const { timer, unsubscribe } = mounted();
    timer.start(1);
    vi.advanceTimersByTime(1_000 + AUTO_DISMISS_MS + 250);
    expect(timer.getState().endsAt).toBeNull();
    unsubscribe();
  });

  it('extends a running rest and restarts a finished one', () => {
    const onZero = vi.fn();
    const { timer, unsubscribe } = mounted(onZero);

    timer.start(60);
    vi.advanceTimersByTime(10_000);
    timer.extend(30);
    expect(timer.getState()).toMatchObject({ remaining: 80, duration: 90 });

    // Run it out, then +30 from the finished state starts a fresh 30 s.
    vi.advanceTimersByTime(80_000);
    expect(onZero).toHaveBeenCalledTimes(1);
    timer.extend(30);
    expect(timer.getState()).toMatchObject({ remaining: 30, duration: 30, running: true });

    vi.advanceTimersByTime(30_000);
    expect(onZero).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('skip clears the timer and stops ticking', () => {
    const onZero = vi.fn();
    const { timer, unsubscribe } = mounted(onZero);
    timer.start(60);
    timer.skip();
    expect(timer.getState().endsAt).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(120_000);
    expect(onZero).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('notifies subscribers on every tick and stops when the last one leaves', () => {
    const listener = vi.fn();
    const timer = createRestTimer();
    const unsubscribe = timer.subscribe(listener);
    timer.start(10);
    const afterStart = listener.mock.calls.length;

    vi.advanceTimersByTime(1_000);
    expect(listener.mock.calls.length).toBeGreaterThan(afterStart);

    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores non-positive durations', () => {
    const { timer, unsubscribe } = mounted();
    timer.start(0);
    expect(timer.getState().endsAt).toBeNull();
    timer.extend(30);
    expect(timer.getState().endsAt).toBeNull();
    unsubscribe();
  });
});
