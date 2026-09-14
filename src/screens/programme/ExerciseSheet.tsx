import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, NumberField, SegmentedControl, Sheet } from '../../components';
import type { ExerciseLoadState } from '../../db/repo';
import type { CatalogEntry, Exercise, MassUnit } from '../../db/types';
import { formatMassUnit, formatNumber } from '../../logic/format';
import { defaultIncrement, massLabel } from '../../logic/units';
import { FieldLabel, SelectField, TextField, ToggleRow } from './Field';
import {
  MASS_UNIT_OPTIONS,
  MEASURE_OPTIONS,
  SCHEME_HINTS,
  TYPE_OPTIONS,
  UNIT_OPTIONS,
  blankDraft,
  changeMassUnit,
  coerceScheme,
  draftFromExercise,
  hasDenomination,
  incrementDisabled,
  loadApplies,
  schemeOptionsFor,
  validateDraft,
  type ExerciseDraft,
} from './exerciseForm';

export interface ExerciseSheetProps {
  open: boolean;
  /** `undefined` = adding a new exercise. */
  exercise: Exercise | undefined;
  /** The library entry `exercise.catalogId` resolves to, when it has one. */
  libraryEntry?: CatalogEntry | undefined;
  /**
   * What this exercise pre-fills next time and where it comes from — seeds the
   * Load field and its hint. Absent for a new row: there is nothing to know yet.
   */
  loadState?: ExerciseLoadState | undefined;
  /** Denomination a brand-new exercise starts in (Settings → Units). */
  defaultMassUnit?: MassUnit;
  /** Settings → Rest timer, shown as the placeholder when there is no override. */
  defaultRest?: { primary: number; accessory: number };
  onClose: () => void;
  onSave: (draft: ExerciseDraft) => void | Promise<void>;
  onDelete: () => void;
  onSwap: () => void;
  /** Opens the library picker to re-point (or first link) `catalogId`. */
  onChangeLibrary: () => void;
}

const LINK_CLASS = 'min-h-11 text-xs text-accent underline underline-offset-4';

function LibraryLine({
  entry,
  onChange,
}: {
  entry: CatalogEntry | undefined;
  onChange: () => void;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-surface-2/40 px-3 py-2">
      {entry ? (
        <>
          <p className="truncate text-xs text-muted">
            Library: <span className="text-fg">{entry.name}</span>
          </p>
          <div className="mt-0.5 flex items-center gap-4">
            <button type="button" onClick={onChange} className={LINK_CLASS}>
              Change
            </button>
            <Link to={`/programme/library/${entry.id}`} className={LINK_CLASS}>
              View
            </Link>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-x-2">
          <p className="text-xs text-muted">Not linked to library ·</p>
          <button type="button" onClick={onChange} className={LINK_CLASS}>
            Link…
          </button>
        </div>
      )}
    </div>
  );
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
  libraryEntry,
  loadState,
  defaultMassUnit = 'kg',
  defaultRest = { primary: 120, accessory: 90 },
  onClose,
  onSave,
  onDelete,
  onSwap,
  onChangeLibrary,
}: ExerciseSheetProps) {
  // The parent remounts this sheet per target (see its `key`), so the draft is
  // seeded once and never fights a live query refresh while you type.
  const [draft, setDraft] = useState<ExerciseDraft>(() =>
    exercise
      ? draftFromExercise(exercise, loadState?.current ?? exercise.startLoad ?? null)
      : blankDraft(defaultMassUnit),
  );
  const [showErrors, setShowErrors] = useState(false);
  // Once you have typed your own step, switching kg/lb leaves it alone.
  const [incrementEdited, setIncrementEdited] = useState(false);

  const errors = validateDraft(draft);
  const visible = showErrors ? errors : {};
  const noIncrement = incrementDisabled(draft.unit);
  const noun = MEASURE_NOUN[draft.measure];
  const schemeOptions = schemeOptionsFor(draft.type);
  const restDefault = draft.type === 'primary' ? defaultRest.primary : defaultRest.accessory;

  // The Load field. Which number it holds is `getExerciseLoadState`'s call:
  // before there is history it is what the first session starts on, after it
  // the load the next session pre-fills.
  const showLoad = loadApplies(draft);
  const loadSuffix = formatMassUnit({ unit: draft.unit, massUnit: draft.massUnit });
  const loadStep =
    draft.increment && draft.increment > 0
      ? draft.increment
      : defaultIncrement(draft.unit, draft.massUnit) || 2.5;
  const hasHistory = loadState?.hasHistory ?? false;
  // Only while the field still holds the override — tapping "Use suggestion"
  // puts the plain number back, and the line should say so before you save.
  const overrideStanding =
    loadState?.source === 'override' && draft.load === (loadState.current ?? null);
  const lastLine =
    loadState?.lastLoad === undefined
      ? ''
      : ` Last session: ${formatNumber(loadState.lastLoad)} ${loadSuffix}.`;
  const loadHint = !hasHistory
    ? 'Pre-fills your first session.'
    : overrideStanding
      ? `Set in Programme.${lastLine}`
      : `Next session starts here.${lastLine}`;

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

        {exercise ? <LibraryLine entry={libraryEntry} onChange={onChangeLibrary} /> : null}

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

        {showLoad ? (
          <div>
            <NumberField
              label="Load"
              value={draft.load}
              onChange={(load) => patch({ load })}
              step={loadStep}
              min={0}
              suffix={loadSuffix}
              hint={loadHint}
            />
            {overrideStanding && loadState?.suggested !== undefined ? (
              <button
                type="button"
                onClick={() => patch({ load: loadState.suggested ?? null })}
                className={LINK_CLASS}
              >
                Use suggestion · {formatNumber(loadState.suggested)} {loadSuffix}
              </button>
            ) : null}
          </div>
        ) : null}

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

        {hasDenomination(draft.unit) ? (
          <div>
            <FieldLabel>Denomination</FieldLabel>
            <SegmentedControl
              label="Denomination"
              value={draft.massUnit}
              options={MASS_UNIT_OPTIONS}
              onChange={(massUnit) =>
                patch(changeMassUnit(draft, massUnit, incrementEdited))
              }
            />
            <p className="mt-1 text-xs text-muted">
              What this machine or rack is marked in. Stored per exercise.
            </p>
          </div>
        ) : null}

        <NumberField
          label="Increment"
          value={noIncrement ? 0 : draft.increment}
          onChange={(increment) => {
            setIncrementEdited(true);
            patch({ increment });
          }}
          step={draft.massUnit === 'lb' ? 1 : 0.5}
          min={0}
          suffix={massLabel(draft.massUnit)}
          disabled={noIncrement}
          hint={
            visible.increment ??
            (noIncrement
              ? 'Bands, bodyweight and conditioning track reps only.'
              : 'How far the load moves when Progression says it moves.')
          }
        />

        <SelectField
          label="Type"
          value={draft.type}
          options={TYPE_OPTIONS}
          onChange={(type) => patch({ type, scheme: coerceScheme(draft.scheme, type) })}
          hint="Primary lifts progress first; conditioning just logs a time."
        />

        <SelectField
          label="Progression"
          value={draft.scheme}
          options={schemeOptions}
          onChange={(scheme) => patch({ scheme })}
          hint={SCHEME_HINTS[draft.scheme]}
        />

        <NumberField
          label="Rest"
          value={draft.restOverride}
          onChange={(restOverride) => patch({ restOverride })}
          step={15}
          min={0}
          max={900}
          suffix="s"
          placeholder={String(restDefault)}
          hint={`Default ${restDefault} s. Leave empty to use it.`}
        />

        <div>
          <FieldLabel htmlFor="exercise-note">Note</FieldLabel>
          <textarea
            id="exercise-note"
            value={draft.note}
            onChange={(e) => patch({ note: e.target.value })}
            rows={2}
            placeholder="Seat 4, handles narrow"
            className="w-full rounded-xl border border-border bg-surface p-3 text-base text-fg outline-none focus:border-accent"
          />
          <p className="mt-1 text-xs text-muted">Shown under the name in Session.</p>
        </div>

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
