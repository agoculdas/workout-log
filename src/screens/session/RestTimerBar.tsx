import { formatClock, type RestTimerHandle } from '../../hooks/useRestTimer';

export interface RestTimerBarProps {
  timer: RestTimerHandle;
  /** e.g. "Rest · Hack squat". */
  label: string;
}

/**
 * Sticky rest countdown. Sits directly above the session's prev/next bar and
 * stays put while you move between exercises.
 */
export function RestTimerBar({ timer, label }: RestTimerBarProps) {
  if (timer.endsAt === null) return null;

  const done = !timer.running;
  const pct = Math.round(Math.min(1, Math.max(0, timer.progress)) * 100);

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-t border-border/70 bg-surface-2/95 px-4 pt-2 pb-2 backdrop-blur"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] tracking-wide text-muted uppercase">
            {done ? 'Rest over — next set' : label}
          </div>
          <div
            className={[
              'text-3xl leading-tight font-bold tabular-nums',
              done ? 'text-accent' : 'text-fg',
            ].join(' ')}
          >
            {formatClock(timer.remaining)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => timer.extend(30)}
          className="min-h-12 shrink-0 rounded-xl border border-border bg-surface px-3 text-sm font-medium text-fg active:bg-border"
        >
          +30s
        </button>
        <button
          type="button"
          onClick={timer.skip}
          className="min-h-12 shrink-0 rounded-xl px-3 text-sm text-muted active:bg-surface"
        >
          {done ? 'Dismiss' : 'Skip'}
        </button>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface">
        <div
          className={['h-full rounded-full transition-[width]', done ? 'bg-accent' : 'bg-accent/70'].join(' ')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default RestTimerBar;
