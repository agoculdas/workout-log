import { NumberField } from '../../components';
import { formatDuration, formatMassUnit } from '../../logic/format';
import { defaultIncrement, exerciseMassUnit } from '../../logic/units';
import { warmupLabel } from './warmup';
import type { Exercise } from '../../db/types';

export interface SetRowProps {
  exercise: Exercise;
  /** 0-based for working sets; negative (−1, −2, …) for warm-ups. */
  setIndex: number;
  load: number | null;
  reps: number | null;
  /** This set is already in the database for this session. */
  done: boolean;
  /** Logged, but the fields no longer match what was stored. */
  dirty: boolean;
  /** A warm-up row: dimmed, removable, and excluded from progression. */
  warmup?: boolean;
  /** The user marked this set as taken to failure. Working rows only. */
  toFailure?: boolean;
  /** Small line under the fields — the progression reason on the first set. */
  hint?: string;
  /**
   * Plain text for a record this set just beat, e.g. "PR" or "PR · e1RM".
   * A fact, shown once the set is logged — no badge, no motion, no copy.
   */
  record?: string;
  onLoadChange: (value: number | null) => void;
  onRepsChange: (value: number | null) => void;
  onDone: () => void;
  onUndo: () => void;
  /** Omit to hide the to-failure toggle (warm-ups, conditioning). */
  onToggleFailure?: () => void;
  /** Omit to hide the remove control (working rows). */
  onRemove?: () => void;
  /** Omit unless this exercise has a plate breakdown worth showing. */
  onPlates?: () => void;
}

/** Nothing to load: show a chip instead of a number field. */
const NO_LOAD_CHIP: Partial<Record<Exercise['unit'], string>> = {
  band: 'band',
  bodyweight: 'BW',
  none: '—',
};

/** "kg" / "lb" / "kg/hand" — the exercise's own denomination. */
function loadSuffix(exercise: Exercise): string | undefined {
  if (exercise.unit === 'kg_side' || exercise.unit === 'kg_total') {
    return formatMassUnit(exercise);
  }
  return undefined;
}

/** The step the -/+ buttons move the load by, in the exercise's denomination. */
function loadStep(exercise: Exercise): number {
  return exercise.increment || defaultIncrement(exercise.unit, exerciseMassUnit(exercise));
}

function measureLabel(exercise: Exercise): string {
  if (exercise.measure === 'seconds') return 'Seconds';
  if (exercise.measure === 'laps') return 'Laps';
  return exercise.perSide ? 'Reps (each side)' : 'Reps';
}

/** One loggable set: load, reps/seconds/laps, and a thumb-sized done button. */
export function SetRow({
  exercise,
  setIndex,
  load,
  reps,
  done,
  dirty,
  warmup = false,
  toFailure = false,
  hint,
  record,
  onLoadChange,
  onRepsChange,
  onDone,
  onUndo,
  onToggleFailure,
  onRemove,
  onPlates,
}: SetRowProps) {
  const chip = NO_LOAD_CHIP[exercise.unit];
  const showLoad = chip === undefined;
  const isConditioning = exercise.type === 'conditioning';
  const canLog = reps !== null && reps > 0;
  const suffix = loadSuffix(exercise);
  const label = warmup ? warmupLabel(setIndex) : String(setIndex + 1);

  const loadField = (
    <NumberField
      label="Load"
      value={load}
      onChange={onLoadChange}
      step={loadStep(exercise) || 2.5}
      suffix={onPlates ? undefined : suffix}
      placeholder="0"
    />
  );

  return (
    <div
      className={[
        'rounded-2xl border p-3',
        warmup
          ? done
            ? 'border-accent/25 bg-accent/[0.03]'
            : 'border-border/40 bg-surface/60'
          : done
            ? 'border-accent/50 bg-accent/5'
            : 'border-border/70 bg-surface',
      ].join(' ')}
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          className={[
            'flex h-7 min-w-7 items-center justify-center rounded-lg px-2 text-xs font-bold tabular-nums',
            warmup
              ? 'bg-surface-2 text-muted'
              : done
                ? 'bg-accent text-[#14200a]'
                : 'bg-surface-2 text-muted',
          ].join(' ')}
        >
          {isConditioning && !warmup ? '•' : label}
        </span>
        <span className={warmup ? 'text-sm text-muted/70' : 'text-sm text-muted'}>
          {warmup ? 'Warm-up' : isConditioning ? 'Your time' : `Set ${setIndex + 1}`}
        </span>
        {record ? (
          <span className="ml-auto text-xs font-medium text-accent">{record}</span>
        ) : null}
        {!showLoad ? (
          <span
            className={[
              record ? '' : 'ml-auto',
              'rounded-lg bg-surface-2 px-2 py-1 text-xs text-muted',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {chip}
          </span>
        ) : null}
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove warm-up ${label}`}
            className={[
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted active:bg-surface-2',
              showLoad ? 'ml-auto' : '',
            ].join(' ')}
          >
            <span aria-hidden="true" className="text-base leading-none">
              ×
            </span>
          </button>
        ) : null}
      </div>

      {showLoad ? (
        onPlates ? (
          // The suffix doubles as the plate-calculator button. NumberField
          // renders its own (inert) suffix inside the input, so it is dropped
          // here and this one is parked over the same spot: the "+" stepper
          // (56px) plus the 8px gap put the input's right edge 64px in, the
          // suffix sits 12px inside that, and the button's own 8px padding
          // comes back off — 68px. The field row is the bottom 56px of the
          // wrapper, so a 44px target centres at 6px from the bottom.
          <div className="relative mb-3">
            {loadField}
            <button
              type="button"
              onClick={onPlates}
              aria-label="Plate calculator"
              className="absolute right-[4.25rem] bottom-1.5 flex h-11 items-center rounded-lg px-2 text-accent active:bg-surface-2"
            >
              <span className="text-xs leading-none underline underline-offset-2">{suffix}</span>
            </button>
          </div>
        ) : (
          <div className="mb-3">{loadField}</div>
        )
      ) : null}

      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <NumberField
            label={measureLabel(exercise)}
            value={reps}
            onChange={onRepsChange}
            step={exercise.measure === 'seconds' ? 5 : 1}
            inputMode="numeric"
            placeholder="0"
            hint={
              exercise.measure === 'seconds' && reps
                ? `${formatDuration(reps)}${hint ? ` · ${hint}` : ''}`
                : hint
            }
          />
        </div>
        {onToggleFailure ? (
          // mt-5 drops the button past the field's own label (12px text + 4px
          // margin) so it lines up with the input row, not with the label.
          <button
            type="button"
            onClick={onToggleFailure}
            aria-pressed={toFailure}
            aria-label="To failure"
            title="To failure"
            className={[
              'mt-5 flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border transition-colors',
              toFailure
                ? 'border-accent bg-accent text-[#14200a]'
                : 'border-border bg-surface text-muted active:bg-surface-2',
            ].join(' ')}
          >
            <span className="text-base leading-none font-semibold">F</span>
          </button>
        ) : null}
      </div>

      <div className="mt-3 flex gap-2">
        {done ? (
          <button
            type="button"
            onClick={onUndo}
            className="min-h-14 shrink-0 rounded-2xl border border-border bg-surface-2 px-4 text-sm text-muted active:bg-border"
          >
            Undo
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDone}
          disabled={!canLog}
          aria-label={
            done
              ? `Update ${warmup ? `warm-up ${label}` : `set ${setIndex + 1}`}`
              : `Log ${warmup ? `warm-up ${label}` : `set ${setIndex + 1}`}`
          }
          className={[
            'flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl text-base font-semibold transition-colors',
            'disabled:pointer-events-none disabled:opacity-40',
            done && !dirty
              ? 'border border-accent/50 bg-accent/10 text-accent'
              : 'bg-accent text-[#14200a] active:bg-accent-strong',
          ].join(' ')}
        >
          <span aria-hidden="true" className="text-xl leading-none">
            ✓
          </span>
          {done ? (dirty ? 'Save changes' : 'Logged') : 'Done'}
        </button>
      </div>
    </div>
  );
}

export default SetRow;
