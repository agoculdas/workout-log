import { useState } from 'react';
import { Button, ConfirmDialog, NumberField, Sheet } from '../../components';
import { deleteSet, updateSet } from '../../db/repo';
import { formatDuration } from '../../logic/format';
import type { Exercise, SetLog } from '../../db/types';

export interface EditSetSheetProps {
  /** The set being edited; `null` closes the sheet. */
  set: SetLog | null;
  exercise: Exercise;
  /** 1-based position shown in the title. */
  setNumber: number;
  onClose: () => void;
}

/** Units with nothing to load — the same rule the Session screen's SetRow uses. */
const NO_LOAD: ReadonlySet<Exercise['unit']> = new Set(['band', 'bodyweight', 'none']);

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

/**
 * Correct or remove one already-logged set. Shared by the History session
 * breakdown and the per-exercise history, so a typo is fixable from wherever
 * you spot it.
 */
export function EditSetSheet({ set, exercise, setNumber, onClose }: EditSetSheetProps) {
  // Keyed by set id below, so the drafts start from the right numbers.
  const [load, setLoad] = useState<number | null>(set?.load ?? 0);
  const [reps, setReps] = useState<number | null>(set?.reps ?? 0);
  const [confirming, setConfirming] = useState(false);

  if (!set) return null;

  const showLoad = !NO_LOAD.has(exercise.unit);

  const save = async () => {
    await updateSet(set.id, { load: load ?? 0, reps: reps ?? 0 });
    onClose();
  };

  const remove = async () => {
    setConfirming(false);
    await deleteSet(set.id);
    onClose();
  };

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        title={`${exercise.name} · set ${setNumber}`}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" full onClick={onClose}>
              Cancel
            </Button>
            <Button full disabled={!reps} onClick={() => void save()}>
              Save
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {showLoad ? (
            <NumberField
              label="Load"
              value={load}
              onChange={(value) => setLoad(value)}
              step={exercise.increment || 2.5}
              suffix={loadSuffix(exercise)}
              placeholder="0"
            />
          ) : null}

          <NumberField
            label={measureLabel(exercise)}
            value={reps}
            onChange={(value) => setReps(value)}
            step={exercise.measure === 'seconds' ? 5 : 1}
            inputMode="numeric"
            placeholder="0"
            hint={exercise.measure === 'seconds' && reps ? formatDuration(reps) : undefined}
          />

          <div className="border-t border-border/70 pt-3">
            <Button full variant="ghost" onClick={() => setConfirming(true)}>
              Delete set
            </Button>
          </div>
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirming}
        title="Delete this set?"
        message="It is removed from the session and from every chart. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => void remove()}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

export default EditSetSheet;
