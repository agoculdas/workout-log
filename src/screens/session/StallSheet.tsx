import { Button, Sheet } from '../../components';
import { formatLoad } from '../../logic/format';
import { deloadLoad } from '../../logic/progression';
import type { Exercise, ExerciseOverride } from '../../db/types';

export interface StallSheetProps {
  open: boolean;
  onClose: () => void;
  exercise: Exercise;
  /** Heaviest working load of the last session, in the exercise's own denomination. */
  lastLoad: number;
  /** The answer standing right now, when one is. */
  current: ExerciseOverride | undefined;
  /** `undefined` clears the override and goes back to the plain suggestion. */
  onChoose: (override: ExerciseOverride | undefined) => void;
}

/** Module scope on purpose: the clock stays out of the component body. */
function stamp(kind: ExerciseOverride['kind'], load: number, reps: number): ExerciseOverride {
  return { load, reps, kind, setAt: Date.now() };
}

/**
 * What to do about a stall — opened by hand from the stalled marker, never
 * shown on its own. The three answers are yours to pick: nothing here ever
 * happens automatically, and whatever you choose is cleared again the moment
 * the exercise is logged (see `finishSession`).
 */
export function StallSheet({
  open,
  onClose,
  exercise,
  lastLoad,
  current,
  onChoose,
}: StallSheetProps) {
  const deload = deloadLoad(exercise, lastLoad);
  // Nothing to take 10% off a bodyweight or band row, and no range to drop to
  // when the target is a single number.
  const canDeload = lastLoad > 0 && deload > 0 && deload < lastLoad;
  const canBottom = exercise.repMin < exercise.repMax;

  const choose = (kind: ExerciseOverride['kind'], load: number) => {
    onChoose(stamp(kind, load, exercise.repMin));
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={exercise.name}>
      <div className="space-y-4">
        {/* The same three answers serve two openings — the stalled marker, and
            a load typed into the Programme — so the line says which one it is
            rather than asserting a stall that never happened. */}
        <p className="text-sm text-muted">
          {current?.kind === 'manual'
            ? `Set in the Programme: ${formatLoad(exercise, current.load)}.`
            : 'Fewer total reps at the same load in the last 2 sessions.'}
        </p>

        <div className="flex flex-col gap-2">
          {canDeload ? (
            <Button
              full
              variant={current?.kind === 'deload' ? 'primary' : 'secondary'}
              onClick={() => choose('deload', deload)}
            >
              Deload 10% · {formatLoad(exercise, deload)}
            </Button>
          ) : null}

          {canBottom ? (
            <Button
              full
              variant={current?.kind === 'bottom' ? 'primary' : 'secondary'}
              onClick={() => choose('bottom', lastLoad)}
            >
              Bottom of range · {exercise.repMin} reps
            </Button>
          ) : null}

          <Button
            full
            variant={current ? 'secondary' : 'primary'}
            onClick={() => {
              onChoose(undefined);
              onClose();
            }}
          >
            Keep the suggestion
          </Button>
        </div>

        {/* It pre-fills straight away — including the sets still open on this
            screen — and `finishSession` drops it once the exercise is logged.
            Saying "next session" would be wrong in the commoner case. */}
        <p className="text-xs text-muted">
          Pre-fills the sets you have not logged yet, then it is dropped.
        </p>
      </div>
    </Sheet>
  );
}

export default StallSheet;
