import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, ConfirmDialog, SegmentedControl } from '../../components';
import {
  addExerciseFromCatalog,
  archiveExercise,
  defaultIncrementFor,
  getCatalogEntriesByIds,
  listExercises,
  listTemplates,
  reorderExercises,
  upsertExercise,
} from '../../db/repo';
import type { CatalogEntry, Exercise, TemplateId } from '../../db/types';
import { formatPrescription } from '../../logic/format';
import ExerciseSheet from './ExerciseSheet';
import LibraryPickerSheet from './LibraryPickerSheet';
import { draftToInput, incrementLabel, unitLabel, type ExerciseDraft } from './exerciseForm';
import { muscleList } from './libraryUtils';

const TYPE_BADGE: Record<Exercise['type'], string> = {
  primary: 'bg-accent/15 text-accent',
  accessory: 'bg-surface-2 text-muted',
  conditioning: 'bg-surface-2 text-fg',
};

/** Which library flow the picker sheet is currently serving. */
type PickerMode = 'add' | 'swap' | 'relink';

interface RowProps {
  exercise: Exercise;
  /** "Quads, glutes" from the linked library entry, when there is one. */
  muscles: string;
  first: boolean;
  last: boolean;
  onEdit: () => void;
  onMove: (direction: -1 | 1) => void;
}

function ExerciseRow({ exercise, muscles, first, last, onEdit, onMove }: RowProps) {
  return (
    <li className="flex items-stretch gap-2 border-b border-border/60 last:border-b-0">
      <button
        type="button"
        onClick={onEdit}
        className="min-w-0 flex-1 py-3 pr-1 pl-4 text-left active:bg-surface-2"
      >
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-base font-medium">{exercise.name}</span>
          <span
            className={[
              'shrink-0 rounded-full px-2 py-0.5 text-[10px] tracking-wide uppercase',
              TYPE_BADGE[exercise.type],
            ].join(' ')}
          >
            {exercise.type}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
          <span>{formatPrescription(exercise)}</span>
          <span aria-hidden="true">·</span>
          <span>{unitLabel(exercise.unit)}</span>
          <span aria-hidden="true">·</span>
          <span>{incrementLabel(exercise)}</span>
        </div>
        {muscles ? (
          <div className="mt-0.5 truncate text-[11px] text-muted/70">{muscles}</div>
        ) : null}
      </button>
      <div className="flex shrink-0 flex-col justify-center gap-1 pr-3">
        <button
          type="button"
          aria-label={`Move ${exercise.name} up`}
          disabled={first}
          onClick={() => onMove(-1)}
          className="relative h-9 w-11 rounded-lg border border-border bg-surface-2 text-sm leading-none text-fg active:bg-border disabled:opacity-30 before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']"
        >
          ▲
        </button>
        <button
          type="button"
          aria-label={`Move ${exercise.name} down`}
          disabled={last}
          onClick={() => onMove(1)}
          className="relative h-9 w-11 rounded-lg border border-border bg-surface-2 text-sm leading-none text-fg active:bg-border disabled:opacity-30 before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']"
        >
          ▼
        </button>
      </div>
    </li>
  );
}

/**
 * Edit the four fixed programme days: rename, retarget, reorder, add, retire
 * and swap exercises. Everything is a soft change — logged sets are never
 * rewritten, so history keeps resolving old names.
 */
export function DaysEditor() {
  const templates = useLiveQuery(() => listTemplates(), [], []);
  const [templateId, setTemplateId] = useState<TemplateId>('lowerA');

  const exercises = useLiveQuery(() => listExercises(templateId), [templateId], []);
  const archived = useLiveQuery(
    () => listExercises(templateId, true).then((rows) => rows.filter((e) => e.archived)),
    [templateId],
    [],
  );

  // One batched read for every row's muscle hint.
  const catalogIds = exercises.map((e) => e.catalogId).filter((id): id is string => !!id);
  const entriesById = useLiveQuery(
    () => getCatalogEntriesByIds(catalogIds),
    [catalogIds.join(',')],
    new Map<string, CatalogEntry>(),
  );

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetSeq, setSheetSeq] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  // The row a library action just wrote: the live query has not necessarily
  // caught up when the sheet remounts, and the sheet seeds its draft once.
  const [freshRow, setFreshRow] = useState<Exercise | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [picker, setPicker] = useState<PickerMode | null>(null);
  const [pendingLink, setPendingLink] = useState<CatalogEntry | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const editing = editingId
    ? (freshRow?.id === editingId ? freshRow : undefined) ??
      exercises.find((e) => e.id === editingId)
    : undefined;
  const editingEntry = editing?.catalogId ? entriesById.get(editing.catalogId) : undefined;

  const openSheet = (id: string | null) => {
    setEditingId(id);
    setSheetSeq((n) => n + 1);
    setSheetOpen(true);
  };

  const closeSheet = () => {
    setSheetOpen(false);
    setEditingId(null);
    setFreshRow(null);
  };

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= exercises.length) return;
    const ids = exercises.map((e) => e.id);
    const moved = ids[index]!;
    ids[index] = ids[target]!;
    ids[target] = moved;
    await reorderExercises(templateId, ids);
  };

  const save = async (draft: ExerciseDraft) => {
    await upsertExercise(draftToInput(draft, templateId, editing?.id));
    closeSheet();
  };

  const remove = async () => {
    if (editing) await archiveExercise(editing.id);
    setConfirmDelete(false);
    closeSheet();
  };

  /** Put `incomingId` where `outgoing` sat, and retire `outgoing`. */
  const takeOver = async (outgoing: Exercise, incomingId: string) => {
    await archiveExercise(outgoing.id);
    await reorderExercises(
      templateId,
      exercises.map((e) => (e.id === outgoing.id ? incomingId : e.id)),
    );
  };

  const choose = async (entry: CatalogEntry) => {
    if (picker === 'add') {
      const added = await addExerciseFromCatalog(templateId, entry.id);
      setPicker(null);
      setFreshRow(added);
      openSheet(added.id);
      return;
    }
    if (picker === 'swap' && editing) {
      // How you are running it carries over; what the movement *is* does not.
      const incoming = await addExerciseFromCatalog(templateId, entry.id, {
        sets: editing.sets,
        repMin: editing.repMin,
        repMax: editing.repMax,
        type: editing.type,
      });
      await takeOver(editing, incoming.id);
      setPicker(null);
      closeSheet();
      return;
    }
    if (picker === 'relink') {
      setPicker(null);
      setPendingLink(entry);
    }
  };

  const restore = async (replacement: Exercise) => {
    if (!editing) return;
    await archiveExercise(replacement.id, false);
    await takeOver(editing, replacement.id);
    setPicker(null);
    closeSheet();
  };

  /** Re-point the row at another library entry, optionally taking its defaults. */
  const applyLink = async (copyDefaults: boolean) => {
    const entry = pendingLink;
    setPendingLink(null);
    if (!editing || !entry) return;
    const saved = await upsertExercise({
      ...editing,
      catalogId: entry.id,
      ...(copyDefaults
        ? {
            unit: entry.defaultUnit,
            measure: entry.defaultMeasure,
            perSide: entry.unilateral,
            increment: defaultIncrementFor(entry.defaultUnit),
          }
        : {}),
    });
    setFreshRow(saved);
    // Reseed the open sheet so it shows what is now stored.
    setSheetSeq((n) => n + 1);
  };

  return (
    <div>
      <div className="px-4 pb-2">
        <SegmentedControl
          label="Programme day"
          value={templateId}
          onChange={setTemplateId}
          options={templates.map((t) => ({ value: t.id, label: t.name }))}
        />
      </div>

      <ul className="mt-2 border-y border-border/60 bg-surface/40">
        {exercises.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-muted">
            No exercises on this day yet.
          </li>
        ) : (
          exercises.map((exercise, index) => {
            const entry = exercise.catalogId ? entriesById.get(exercise.catalogId) : undefined;
            return (
              <ExerciseRow
                key={exercise.id}
                exercise={exercise}
                muscles={entry ? muscleList(entry.primary) : ''}
                first={index === 0}
                last={index === exercises.length - 1}
                onEdit={() => openSheet(exercise.id)}
                onMove={(direction) => void move(index, direction)}
              />
            );
          })
        )}
      </ul>

      <div className="px-4 pt-4">
        <Button full variant="secondary" onClick={() => setPicker('add')}>
          + Add exercise
        </Button>
      </div>

      <div className="px-4 pt-6 pb-4">
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          className="min-h-11 text-sm text-muted underline underline-offset-4"
          aria-expanded={showArchived}
        >
          {showArchived ? 'Hide' : 'Show'} archived ({archived.length})
        </button>

        {showArchived ? (
          <ul className="mt-2 space-y-2">
            {archived.length === 0 ? (
              <li className="text-sm text-muted">Nothing archived on this day.</li>
            ) : (
              archived.map((exercise) => (
                <li
                  key={exercise.id}
                  className="flex items-center gap-3 rounded-xl border border-border/70 bg-surface px-3 py-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">{exercise.name}</span>
                    <span className="block text-xs text-muted">
                      {formatPrescription(exercise)} · {unitLabel(exercise.unit)}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void archiveExercise(exercise.id, false)}
                  >
                    Restore
                  </Button>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>

      <ExerciseSheet
        key={`${editingId ?? 'new'}:${sheetSeq}`}
        open={sheetOpen}
        exercise={editing}
        libraryEntry={editingEntry}
        onClose={closeSheet}
        onSave={save}
        onDelete={() => setConfirmDelete(true)}
        onSwap={() => setPicker('swap')}
        onChangeLibrary={() => setPicker('relink')}
      />

      {/* Keyed by mode so each open starts with a clean search and filter. */}
      <LibraryPickerSheet
        key={picker ?? 'closed'}
        open={picker !== null}
        title={
          picker === 'swap'
            ? `Swap out ${editing?.name ?? 'exercise'}`
            : picker === 'relink'
              ? 'Link to a library entry'
              : 'Add an exercise'
        }
        note={
          picker === 'swap'
            ? 'The current exercise is retired (its history is kept) and the one you pick takes its place, keeping your sets and reps.'
            : picker === 'relink'
              ? 'Re-points this row at another movement. Sets and reps stay as they are.'
              : 'Picked movements land at the bottom of the day — you can adjust the sets and reps straight after.'
        }
        actionLabel={picker === 'swap' ? 'Swap in' : picker === 'relink' ? 'Link' : 'Add'}
        retired={picker === 'swap' ? archived : undefined}
        onRestore={(row) => void restore(row)}
        onChoose={(entry) => void choose(entry)}
        onCreateCustom={
          picker === 'add'
            ? () => {
                setPicker(null);
                openSheet(null);
              }
            : undefined
        }
        onClose={() => setPicker(null)}
      />

      <ConfirmDialog
        open={pendingLink !== null}
        destructive={false}
        title={`Link to ${pendingLink?.name ?? 'entry'}?`}
        message="Also take its load unit, measure and per-side default? Your sets, reps and increment stay as they are either way."
        confirmLabel="Link and copy"
        cancelLabel="Link only"
        onConfirm={() => void applyLink(true)}
        onCancel={() => void applyLink(false)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title={`Remove ${editing?.name ?? 'exercise'}?`}
        message="It disappears from future sessions. Logged sets keep their name, and you can restore it from “Show archived”."
        confirmLabel="Remove"
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

export default DaysEditor;
