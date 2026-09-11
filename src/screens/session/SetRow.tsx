import { NumberField } from '../../components';
import { formatDuration } from '../../logic/format';
import type { Exercise } from '../../db/types';

export interface SetRowProps {
  exercise: Exercise;
  /** 0-based. */
  setIndex: number;
  load: number | null;
  reps: number | null;
  /** This set is already in the database for this session. */
  done: boolean;
  /** Logged, but the fields no longer match what was stored. */
  dirty: boolean;
  /** Small line under the fields — the progression reason on the first set. */
  hint?: string;
  onLoadChange: (value: number | null) => void;
  onRepsChange: (value: number | null) => void;
  onDone: () => void;
  onUndo: () => void;
}

/** Nothing to load: show a chip instead of a number field. */
const NO_LOAD_CHIP: Partial<Record<Exercise['unit'], string>> = {
  band: 'band',
  bodyweight: 'BW',
  none: '—',
};

function loadSuffix(exercise: Exercise): string | undefined {
  if (exercise.unit === 'kg_side') return 'kg/hand';
  if (exercise.unit === 'kg_total') return 'kg';
  return undefined;
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
  hint,
  onLoadChange,
  onRepsChange,
  onDone,
  onUndo,
}: SetRowProps) {
  const chip = NO_LOAD_CHIP[exercise.unit];
  const showLoad = chip === undefined;
  const isConditioning = exercise.type === 'conditioning';
  const canLog = reps !== null && reps > 0;

  return (
    <div
      className={[
        'rounded-2xl border p-3',
        done ? 'border-accent/50 bg-accent/5' : 'border-border/70 bg-surface',
      ].join(' ')}
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          className={[
            'flex h-7 min-w-7 items-center justify-center rounded-lg px-2 text-xs font-bold tabular-nums',
            done ? 'bg-accent text-[#14200a]' : 'bg-surface-2 text-muted',
          ].join(' ')}
        >
          {isConditioning ? '•' : setIndex + 1}
        </span>
        <span className="text-sm text-muted">
          {isConditioning ? 'Your time' : `Set ${setIndex + 1}`}
        </span>
        {!showLoad ? (
          <span className="ml-auto rounded-lg bg-surface-2 px-2 py-1 text-xs text-muted">{chip}</span>
        ) : null}
      </div>

      {showLoad ? (
        <NumberField
          label="Load"
          value={load}
          onChange={onLoadChange}
          step={exercise.increment || 2.5}
          suffix={loadSuffix(exercise)}
          placeholder="0"
          className="mb-3"
        />
      ) : null}

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
          aria-label={done ? `Update set ${setIndex + 1}` : `Log set ${setIndex + 1}`}
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
