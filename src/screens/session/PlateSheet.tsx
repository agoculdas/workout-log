import { Sheet } from '../../components';
import { formatNumber } from '../../logic/format';
import { platesPerSide } from '../../logic/plates';
import { exerciseMassUnit, fromKg, massLabel, toKg } from '../../logic/units';
import type { Exercise } from '../../db/types';

export interface PlateSheetProps {
  open: boolean;
  onClose: () => void;
  exercise: Exercise;
  /** The load currently in the field, in the exercise's own denomination. */
  load: number | null;
  /** Bar weight in kilograms. */
  barWeight: number;
  /** Plate sizes available per side, in kilograms. */
  plates: number[];
}

/**
 * What to hang on the bar. Everything in `logic/plates` is kilograms, so a
 * pound-denominated exercise is converted first and both numbers are shown —
 * the gym's bar and plates are still metric even when the rack is marked in lb.
 * The shortfall line is kilograms-only for the same reason: a pound target
 * never lands on the metric grid, so the "on the bar" comparison says it
 * better than a quarter-kilo of conversion dust would.
 */
export function PlateSheet({
  open,
  onClose,
  exercise,
  load,
  barWeight,
  plates,
}: PlateSheetProps) {
  const mass = exerciseMassUnit(exercise);
  const entered = load ?? 0;
  const targetKg = toKg(entered, mass);
  const breakdown = platesPerSide(targetKg, barWeight, plates);
  const loadedPerSide = breakdown.perSide.reduce((sum, p) => sum + p, 0);

  return (
    <Sheet open={open} onClose={onClose} title="Plates">
      <div className="space-y-4">
        <div>
          <div className="text-3xl font-bold tracking-tight tabular-nums">
            {formatNumber(entered)} {massLabel(mass)}
          </div>
          {mass === 'lb' ? (
            <div className="mt-0.5 text-sm text-muted tabular-nums">
              {formatNumber(entered)} lb ≈ {formatNumber(Number(targetKg.toFixed(1)))} kg
            </div>
          ) : null}
          <div className="mt-0.5 text-sm text-muted tabular-nums">
            Bar {formatNumber(breakdown.bar)} kg
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">
            Per side
          </div>
          {breakdown.perSide.length ? (
            <div className="flex flex-wrap gap-2">
              {breakdown.perSide.map((plate, i) => (
                <span
                  key={`${plate}:${i}`}
                  className="inline-flex min-h-10 items-center rounded-full border border-border bg-surface-2 px-3 text-sm tabular-nums"
                >
                  {formatNumber(plate)}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">
              Nothing — the bar alone is {formatNumber(breakdown.bar)} kg.
            </p>
          )}
          {breakdown.perSide.length ? (
            <p className="mt-2 text-xs text-muted tabular-nums">
              {formatNumber(loadedPerSide)} kg a side.
            </p>
          ) : null}
        </div>

        <div className="border-t border-border/70 pt-3 text-sm tabular-nums">
          <div className="flex justify-between gap-3">
            <span className="text-muted">On the bar</span>
            <span>
              {formatNumber(breakdown.total)} kg
              {mass === 'lb'
                ? ` ≈ ${formatNumber(Number(fromKg(breakdown.total, 'lb').toFixed(1)))} lb`
                : ''}
            </span>
          </div>
          {mass === 'kg' && breakdown.remainder > 0 ? (
            <p className="mt-1 text-xs text-muted">
              {formatNumber(breakdown.remainder)} kg short — no{' '}
              {formatNumber(breakdown.remainder / 2)} plates.
            </p>
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}

export default PlateSheet;
