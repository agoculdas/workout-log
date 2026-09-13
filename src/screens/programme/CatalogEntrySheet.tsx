import { useId, useState } from 'react';
import { Button, Chip, ConfirmDialog, Sheet } from '../../components';
import {
  listExercisesForCatalog,
  renameCatalogEntry,
  upsertCatalogEntry,
} from '../../db/repo';
import { MUSCLES, type CatalogEntry, type Muscle } from '../../db/types';
import { MUSCLE_LABELS, SPLIT_TAG_GROUP_LABELS, SPLIT_TAG_LABELS } from '../../db/labels';
import { FieldLabel, SelectField, TextField, ToggleRow } from './Field';
import { MEASURE_OPTIONS, UNIT_OPTIONS } from './exerciseForm';
import {
  EQUIPMENT_OPTIONS,
  PATTERN_OPTIONS,
  TAG_FILTER_GROUPS,
  blankCatalogDraft,
  draftFromEntry,
  draftToCatalogInput,
  toggleMuscle,
  toggleTag,
  validateCatalogDraft,
  type CatalogDraft,
} from './libraryUtils';

export interface CatalogEntrySheetProps {
  open: boolean;
  /** `undefined` = creating a new library entry. */
  entry: CatalogEntry | undefined;
  onClose: () => void;
  /** Fired after the row is written, with the stored entry. */
  onSaved?: (entry: CatalogEntry) => void;
}

interface MuscleGridProps {
  label: string;
  hint: string;
  selected: Muscle[];
  onToggle: (muscle: Muscle) => void;
}

function MuscleGrid({ label, hint, selected, onToggle }: MuscleGridProps) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <p className="mb-2 text-xs text-muted">{hint}</p>
      <div className="flex flex-wrap gap-2">
        {MUSCLES.map((muscle) => (
          <Chip
            key={muscle}
            selected={selected.includes(muscle)}
            onClick={() => onToggle(muscle)}
          >
            {MUSCLE_LABELS[muscle]}
          </Chip>
        ))}
      </div>
    </div>
  );
}

/**
 * Add or edit one library entry. Owns its writes (unlike `ExerciseSheet`)
 * because saving a rename can fan out across the programme, and both the
 * Library list and the entry screen open the same form.
 */
export function CatalogEntrySheet({ open, entry, onClose, onSaved }: CatalogEntrySheetProps) {
  const notesId = useId();
  // Seeded once: the parent remounts this sheet per target (see its `key`),
  // so a live-query refresh never overwrites what you are typing.
  const [draft, setDraft] = useState<CatalogDraft>(() =>
    entry ? draftFromEntry(entry) : blankCatalogDraft(),
  );
  const [showErrors, setShowErrors] = useState(false);
  const [pendingRename, setPendingRename] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const errors = validateCatalogDraft(draft);
  const visible = showErrors ? errors : {};

  const patch = (next: Partial<CatalogDraft>) => setDraft((d) => ({ ...d, ...next }));

  const commit = async (propagate: boolean) => {
    setBusy(true);
    try {
      const saved = await upsertCatalogEntry(draftToCatalogInput(draft, entry?.id));
      if (entry && propagate) await renameCatalogEntry(saved.id, saved.name, true);
      setPendingRename(null);
      onSaved?.(saved);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (Object.keys(errors).length) {
      setShowErrors(true);
      return;
    }
    const name = draft.name.trim();
    if (entry && name !== entry.name) {
      const uses = await listExercisesForCatalog(entry.id, true);
      const differing = uses.filter((row) => row.name !== name).length;
      if (differing > 0) {
        setPendingRename(differing);
        return;
      }
    }
    await commit(false);
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={entry ? 'Edit library entry' : 'New library entry'}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" full onClick={onClose}>
              Cancel
            </Button>
            <Button full disabled={busy} onClick={() => void save()}>
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
            placeholder="Bulgarian split squat"
            error={visible.name}
          />

          <MuscleGrid
            label="Primary muscles"
            hint="Counted as a full set each."
            selected={draft.primary}
            onToggle={(muscle) => patch(toggleMuscle(draft, 'primary', muscle))}
          />
          {visible.muscles ? <p className="text-xs text-danger">{visible.muscles}</p> : null}

          <MuscleGrid
            label="Secondary muscles"
            hint="Assisting movers — counted as half a set each."
            selected={draft.secondary}
            onToggle={(muscle) => patch(toggleMuscle(draft, 'secondary', muscle))}
          />

          <SelectField
            label="Equipment"
            value={draft.equipment}
            options={EQUIPMENT_OPTIONS}
            onChange={(equipment) => patch({ equipment })}
          />

          <SelectField
            label="Pattern"
            value={draft.pattern}
            options={PATTERN_OPTIONS}
            onChange={(pattern) => patch({ pattern })}
            hint="Feeds the push / pull / squat / hinge balance."
          />

          <ToggleRow
            label="Unilateral"
            hint="One limb at a time — new programme rows default to “each side”."
            checked={draft.unilateral}
            onChange={(unilateral) => patch({ unilateral })}
          />

          <div>
            <FieldLabel>Split tags</FieldLabel>
            <p className="mb-2 text-xs text-muted">What the movement filters under.</p>
            <div className="space-y-2">
              {TAG_FILTER_GROUPS.map((group) => (
                <div key={group.key}>
                  <p className="mb-1 text-[11px] text-muted">
                    {SPLIT_TAG_GROUP_LABELS[group.key]}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {group.tags.map((tag) => (
                      <Chip
                        key={tag}
                        selected={draft.tags.includes(tag)}
                        onClick={() => patch({ tags: toggleTag(draft.tags, tag) })}
                      >
                        {SPLIT_TAG_LABELS[tag]}
                      </Chip>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <SelectField
            label="Default load unit"
            value={draft.defaultUnit}
            options={UNIT_OPTIONS}
            onChange={(defaultUnit) => patch({ defaultUnit })}
            hint="What a new programme row starts with."
          />

          <SelectField
            label="Default measure"
            value={draft.defaultMeasure}
            options={MEASURE_OPTIONS}
            onChange={(defaultMeasure) => patch({ defaultMeasure })}
          />

          <div>
            <FieldLabel htmlFor={notesId}>Notes</FieldLabel>
            <textarea
              id={notesId}
              rows={3}
              value={draft.notes}
              onChange={(e) => patch({ notes: e.target.value })}
              placeholder="Setup cues, bar height, anything worth remembering."
              className="w-full resize-y rounded-xl border border-border bg-surface px-3 py-2 text-base text-fg outline-none focus:border-accent"
            />
          </div>

          <p className="text-xs text-muted">
            Library edits describe the movement. Sets, reps and increments stay on the
            programme row.
          </p>
        </div>
      </Sheet>

      <ConfirmDialog
        open={pendingRename !== null}
        destructive={false}
        title={`Also rename ${pendingRename ?? 0} programme exercise${pendingRename === 1 ? '' : 's'}?`}
        message={`“${entry?.name ?? ''}” is on your programme under its old name. Renaming keeps everything pointing at this movement either way — logged sets are never rewritten.`}
        confirmLabel={`Rename all ${pendingRename ?? 0}`}
        cancelLabel="Only the library"
        onConfirm={() => void commit(true)}
        onCancel={() => void commit(false)}
        onDismiss={() => setPendingRename(null)}
      />
    </>
  );
}

export default CatalogEntrySheet;
