import { useState } from 'react';
import { Card } from '../../components';
import type { Session } from '../../db/types';
import {
  WEEKDAY_LABELS,
  monthGrid,
  monthLabel,
  sessionsByDay,
  shiftMonth,
} from './calendarGrid';

export interface CalendarProps {
  /** The sessions to mark. Only the day each one lands on is read. */
  sessions: readonly Session[];
  /** The day the list is filtered to, YYYY-MM-DD, or null for all of them. */
  selected: string | null;
  /** Tapping a trained day filters to it; tapping it again clears. */
  onSelect: (date: string | null) => void;
}

/** Today, as a local YYYY-MM-DD — the cell that gets the outline. */
function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * A month of trained days. A dot per session, nothing more: no counts, no
 * colour scale, and deliberately no streak — the calendar says what happened,
 * it does not keep score.
 */
export function Calendar({ sessions, selected, onSelect }: CalendarProps) {
  const [view, setView] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const grid = monthGrid(view.year, view.month);
  const byDay = sessionsByDay(sessions);
  const today = todayKey();

  return (
    <Card className="mb-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setView(shiftMonth(view.year, view.month, -1))}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg text-muted active:bg-surface-2"
        >
          ‹
        </button>
        <h3 className="min-w-0 truncate text-sm font-semibold" aria-live="polite">
          {monthLabel(grid.year, grid.month)}
        </h3>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setView(shiftMonth(view.year, view.month, 1))}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg text-muted active:bg-surface-2"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="pb-1 text-[10px] tracking-wide text-muted uppercase">
            {label}
          </div>
        ))}

        {grid.weeks.flat().map((cell) => {
          const trained = byDay.get(cell.date) ?? [];
          const isSelected = selected === cell.date;
          return (
            <button
              key={cell.date}
              type="button"
              disabled={!trained.length}
              aria-pressed={trained.length ? isSelected : undefined}
              aria-label={
                trained.length
                  ? `${cell.date}, ${trained.length} session${trained.length === 1 ? '' : 's'}`
                  : cell.date
              }
              onClick={() => onSelect(isSelected ? null : cell.date)}
              className={[
                'flex h-11 flex-col items-center justify-center gap-1 rounded-lg text-sm tabular-nums',
                cell.inMonth ? '' : 'text-muted/35',
                trained.length ? 'active:bg-surface-2' : '',
                isSelected ? 'bg-accent/15 text-accent' : '',
                !isSelected && cell.date === today ? 'ring-1 ring-border' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="leading-none">{cell.day}</span>
              <span className="flex h-1.5 items-center gap-0.5">
                {trained.slice(0, 3).map((session) => (
                  <span
                    key={session.id}
                    aria-hidden="true"
                    className="h-1.5 w-1.5 rounded-full bg-accent"
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

export default Calendar;
