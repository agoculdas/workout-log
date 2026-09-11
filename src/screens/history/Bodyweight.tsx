import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, Card, NumberField } from '../../components';
import { addBodyweight, deleteBodyweight, listBodyweight } from '../../db/repo';
import { formatDate } from '../../logic/format';
import { BodyweightChart } from './charts';
import {
  buildBodyweightSeries,
  dateToTime,
  describeWeeklyChange,
  formatKg,
  sortEntries,
  toISODate,
  weeklyChange,
} from './bodyweightStats';

/**
 * The bodyweight log: add a reading for a date, see the daily line with its
 * 7-day average, and the week-on-week change (I'm on a cut — that number is
 * the whole point of the section).
 */
export function BodyweightSection() {
  const entries = useLiveQuery(() => listBodyweight(), [], undefined);
  const [kg, setKg] = useState<number | null>(null);
  const [date, setDate] = useState(() => toISODate(new Date()));
  const [busy, setBusy] = useState(false);

  const rows = sortEntries(entries ?? []);
  const points = buildBodyweightSeries(rows);
  const change = weeklyChange(rows);
  const changeText = describeWeeklyChange(change);
  const existing = rows.find((e) => e.date === date);

  const add = async () => {
    if (kg === null || kg <= 0 || !date) return;
    setBusy(true);
    try {
      await addBodyweight(date, kg);
      setKg(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 px-4 pb-8">
      <Card className="space-y-3">
        <NumberField
          label="Weight"
          value={kg}
          onChange={setKg}
          step={0.1}
          inputMode="decimal"
          min={0}
          max={400}
          suffix="kg"
          placeholder="0.0"
        />
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <label
              htmlFor="bw-date"
              className="mb-1 block text-xs font-medium tracking-wide text-muted uppercase"
            >
              Date
            </label>
            <input
              id="bw-date"
              type="date"
              value={date}
              max={toISODate(new Date())}
              onChange={(e) => setDate(e.target.value)}
              className="h-12 w-full rounded-xl border border-border bg-surface px-3 text-base text-fg outline-none focus:border-accent"
            />
          </div>
          <Button
            size="md"
            onClick={() => void add()}
            disabled={busy || kg === null || kg <= 0 || !date}
            className="shrink-0"
          >
            {existing ? 'Replace' : 'Add'}
          </Button>
        </div>
        {existing ? (
          <p className="text-xs text-muted">
            {formatDate(dateToTime(existing.date))} already logged at {formatKg(existing.kg)} kg
            — adding replaces it.
          </p>
        ) : null}
      </Card>

      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-2xl font-bold tabular-nums">
            {change.current === null ? '—' : `${formatKg(change.current)} kg`}
          </div>
          <div className="text-xs text-muted">
            7-day average
            {change.currentCount
              ? ` · ${change.currentCount} weigh-in${change.currentCount === 1 ? '' : 's'}`
              : ''}
          </div>
        </div>
        {changeText ? (
          <span
            className={[
              'rounded-full px-2.5 py-1 text-xs font-medium',
              change.delta !== null && change.delta < 0
                ? 'bg-accent/15 text-accent'
                : change.delta !== null && change.delta > 0
                  ? 'bg-danger/15 text-danger'
                  : 'bg-surface-2 text-muted',
            ].join(' ')}
          >
            {changeText}
          </span>
        ) : null}
      </div>

      <BodyweightChart
        data={points}
        aside={points.length ? `${points.length} entries` : undefined}
      />

      {rows.length ? (
        <Card flush>
          <ul className="divide-y divide-border/60">
            {[...rows].reverse().map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {formatDate(dateToTime(entry.date))}
                </span>
                <span className="tabular-nums">{formatKg(entry.kg)} kg</span>
                <button
                  type="button"
                  aria-label={`Delete ${entry.date}`}
                  onClick={() => void deleteBodyweight(entry.id)}
                  className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted active:bg-surface-2"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                    <path
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10 11v5M14 11v5"
                    />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <p className="text-sm text-muted">
          No weigh-ins yet — add one above. One entry per day; adding the same date again
          replaces it.
        </p>
      )}
    </div>
  );
}

export default BodyweightSection;
