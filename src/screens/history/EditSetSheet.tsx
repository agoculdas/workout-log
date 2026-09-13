import { useState } from 'react';
import { Button, Chip, ConfirmDialog, NumberField, Sheet } from '../../components';
import { deleteSet, updateSet } from '../../db/repo';
import { formatDuration, formatMassUnit } from '../../logic/format';
import { setMassUnit } from '../../logic/units';
import type { Exercise, SetLog } from '../../db/types';

export interface EditSetSheetProps {
  /** The set being edited; `null` closes the sheet. */
  set: SetLog | null;
  exercise: Exercise;
  /** How the title names this row: "set 3", "warm-up 1". */
  setLabel: string;
  onClose: () => void;
}

/** Units with nothing to load — the same rule the Session screen's SetRow uses. */
const NO_LOAD: ReadonlySet<Exercise['unit']> = new Set(['band', 'bodyweight', 'none']);

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
export function EditSetSheet({ set, exercise, setLabel, onClose }: EditSetSheetProps) {
  // Keyed by set id below, so the drafts start from the right numbers.
  const [load, setLoad] = useState<number | null>(set?.load ?? 0);
  const [reps, setReps] = useState<number | null>(set?.reps ?? 0);
  const [warmup, setWarmup] = useState(set?.kind === 'warmup');
  const [toFailure, setToFailure] = useState(set?.toFailure === true);
  const [confirming, setConfirming] = useState(false);

  if (!set) return null;

  const showLoad = !NO_LOAD.has(exercise.unit);
  // The set keeps the denomination it was logged in, whatever the row says now.
  const suffix = formatMassUnit({ unit: exercise.unit, massUnit: setMassUnit(set) });

  const save = async () => {
    await updateSet(set.id, {
      load: load ?? 0,
      reps: reps ?? 0,
      // Dexie deletes a key patched with `undefined`, so the row stays clean.
      kind: warmup ? 'warmup' : undefined,
      toFailure: toFailure ? true : undefined,
    });
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
        title={`${exercise.name} · ${setLabel}`}
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
              suffix={suffix}
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

          <div role="group" aria-label="Set marks" className="flex flex-wrap gap-2">
            <Chip selected={warmup} onClick={() => setWarmup((v) => !v)}>
              Warm-up
            </Chip>
            <Chip selected={toFailure} onClick={() => setToFailure((v) => !v)}>
              To failure
            </Chip>
          </div>
          <p className="-mt-2 text-xs text-muted">
            Warm-ups are left out of volume, top sets and progression. “To failure” is
            recorded and nothing else.
          </p>

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
