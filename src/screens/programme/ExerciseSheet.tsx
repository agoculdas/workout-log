import { useState } from 'react';
import { Button, NumberField, Sheet } from '../../components';
import type { Exercise } from '../../db/types';
import { SelectField, TextField, ToggleRow } from './Field';
import {
  MEASURE_OPTIONS,
  TYPE_OPTIONS,
  UNIT_OPTIONS,
  blankDraft,
  draftFromExercise,
  incrementDisabled,
  validateDraft,
  type ExerciseDraft,
} from './exerciseForm';

export interface ExerciseSheetProps {
  open: boolean;
  /** `undefined` = adding a new exercise. */
  exercise: Exercise | undefined;
  onClose: () => void;
  onSave: (draft: ExerciseDraft) => void | Promise<void>;
  onDelete: () => void;
  onSwap: () => void;
}

const MEASURE_NOUN: Record<ExerciseDraft['measure'], string> = {
  reps: 'reps',
  seconds: 'seconds',
  laps: 'laps',
};

/** Add/edit form for one exercise. All writes happen in the parent screen. */
export function ExerciseSheet({
  open,
  exercise,
  onClose,
  onSave,
  onDelete,
  onSwap,
}: ExerciseSheetProps) {
  // The parent remounts this sheet per target (see its `key`), so the draft is
  // seeded once and never fights a live query refresh while you type.
  const [draft, setDraft] = useState<ExerciseDraft>(() =>
    exercise ? draftFromExercise(exercise) : blankDraft(),
  );
  const [showErrors, setShowErrors] = useState(false);

  const errors = validateDraft(draft);
  const visible = showErrors ? errors : {};
  const noIncrement = incrementDisabled(draft.unit);
  const noun = MEASURE_NOUN[draft.measure];

  const patch = (next: Partial<ExerciseDraft>) => setDraft((d) => ({ ...d, ...next }));

  const save = () => {
    if (Object.keys(errors).length) {
      setShowErrors(true);
      return;
    }
    void onSave(draft);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={exercise ? 'Edit exercise' : 'Add exercise'}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" full onClick={onClose}>
            Cancel
          </Button>
          <Button full onClick={save}>
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <TextField
          label="Name"
          value={draft.name}
          onChange={(name) => patch({ name })}
          placeholder="Hack squat"
          error={visible.name}
        />

        <NumberField
          label="Sets"
          value={draft.sets}
          onChange={(sets) => patch({ sets })}
          step={1}
          min={1}
          max={20}
          hint={visible.sets}
        />

        <div>
          <ToggleRow
            label="Rep range"
            hint={draft.range ? 'A window, e.g. 8–10' : 'A single target number'}
            checked={draft.range}
            onChange={(range) =>
              patch(
                range
                  ? { range, repMax: Math.max(draft.repMax ?? 0, draft.repMin ?? 0) }
                  : { range },
              )
            }
          />
          <div className={draft.range ? 'mt-3 space-y-3' : 'mt-3'}>
            <NumberField
              label={draft.range ? `Min ${noun}` : `Target ${noun}`}
              value={draft.repMin}
              onChange={(repMin) =>
                patch(draft.range ? { repMin } : { repMin, repMax: repMin })
              }
              step={draft.measure === 'seconds' ? 5 : 1}
              min={0}
            />
            {draft.range ? (
              <NumberField
                label={`Max ${noun}`}
                value={draft.repMax}
                onChange={(repMax) => patch({ repMax })}
                step={draft.measure === 'seconds' ? 5 : 1}
                min={0}
              />
            ) : null}
          </div>
          {visible.reps ? <p className="mt-1 text-xs text-danger">{visible.reps}</p> : null}
        </div>

        <SelectField
          label="Measure"
          value={draft.measure}
          options={MEASURE_OPTIONS}
          onChange={(measure) => patch({ measure })}
          hint="What the logged number counts."
        />

        <ToggleRow
          label="Each side"
          hint='Shows "each" on the prescription. Does not change the maths.'
          checked={draft.perSide}
          onChange={(perSide) => patch({ perSide })}
        />

        <SelectField
          label="Load unit"
          value={draft.unit}
          options={UNIT_OPTIONS}
          onChange={(unit) =>
            patch(incrementDisabled(unit) ? { unit, increment: 0 } : { unit })
          }
        />

        <NumberField
          label="Increment"
          value={noIncrement ? 0 : draft.increment}
          onChange={(increment) => patch({ increment })}
          step={0.5}
          min={0}
          suffix="kg"
          disabled={noIncrement}
          hint={
            visible.increment ??
            (noIncrement
              ? 'Bands, bodyweight and conditioning track reps only.'
              : 'Added when every set hits the top of the range.')
          }
        />

        <SelectField
          label="Type"
          value={draft.type}
          options={TYPE_OPTIONS}
          onChange={(type) => patch({ type })}
          hint="Primary lifts progress first; conditioning just logs a time."
        />

        <p className="text-xs text-muted">Changes apply to future sessions only.</p>

        {exercise ? (
          <div className="flex gap-3 border-t border-border/70 pt-4">
            <Button variant="secondary" size="md" full onClick={onSwap}>
              Swap…
            </Button>
            <Button variant="danger" size="md" full onClick={onDelete}>
              Delete
            </Button>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

export default ExerciseSheet;
