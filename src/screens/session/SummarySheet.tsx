import { Button, Sheet } from '../../components';
import { formatDuration, formatNumber, formatVolumeKg } from '../../logic/format';
import { massLabel } from '../../logic/units';
import type { SessionSummary } from '../../db/repo';

export interface SummarySheetProps {
  summary: SessionSummary;
  /** Done and the backdrop do the same thing: leave the session. */
  onDone: () => void;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] tracking-wide text-muted uppercase">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/**
 * The post-Finish sheet: what the session came to. Facts only — the numbers
 * that were logged, and where the top set beat the last one. Nothing here
 * feeds a suggestion.
 */
export function SummarySheet({ summary, onDone }: SummarySheetProps) {
  return (
    <Sheet
      open
      onClose={onDone}
      title={summary.templateName}
      footer={
        <Button full onClick={onDone}>
          Done
        </Button>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Duration" value={formatDuration(summary.durationMs / 1000)} />
        <Stat
          label={summary.setsLogged === 1 ? 'Set' : 'Sets'}
          value={String(summary.setsLogged)}
        />
        <Stat label="Volume" value={formatVolumeKg(summary.volumeKg)} />
      </div>

      {summary.warmups > 0 ? (
        <p className="mt-2 text-xs text-muted">
          Plus {summary.warmups} warm-up{summary.warmups === 1 ? '' : 's'}.
        </p>
      ) : null}

      {summary.exercises.length ? (
        <ul className="mt-4 flex flex-col divide-y divide-border/60">
          {summary.exercises.map((row) => (
            <li key={row.exerciseId} className="flex items-start gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-base">{row.name}</div>
                {row.progressed && row.previousTop !== undefined ? (
                  <div className="text-xs text-accent tabular-nums">
                    ↑ from {formatNumber(row.previousTop)} {massLabel(row.massUnit)}
                  </div>
                ) : null}
              </div>
              <div className="shrink-0 text-right text-sm text-muted tabular-nums">
                {row.summary}
                {row.toFailure > 0 ? ` · ${row.toFailure} to failure` : ''}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted">No sets were logged in this session.</p>
      )}
    </Sheet>
  );
}

export default SummarySheet;
