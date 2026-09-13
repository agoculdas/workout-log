import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, ConfirmDialog, IconButton, SegmentedControl } from '../../components';
import {
  addExerciseFromCatalog,
  archiveExercise,
  archiveTemplate,
  createTemplate,
  getCatalogEntriesByIds,
  listExercises,
  listTemplates,
  readActiveProgramme,
  readSettings,
  reorderExercises,
  reorderTemplates,
  updateTemplate,
  upsertExercise,
} from '../../db/repo';
import type { CatalogEntry, Exercise, MassUnit, SplitTag } from '../../db/types';
import { formatPrescription } from '../../logic/format';
import { defaultIncrement, exerciseMassUnit } from '../../logic/units';
import DaySheet from './DaySheet';
import ExerciseSheet from './ExerciseSheet';
import LibraryPickerSheet from './LibraryPickerSheet';
import { draftToInput, incrementLabel, unitLabel, type ExerciseDraft } from './exerciseForm';
import { muscleList, swapOverrides } from './libraryUtils';

/** Sentinel for the trailing "+" tab — never a real day id. */
const ADD_DAY = '__add_day__';

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
          <span>{unitLabel(exercise.unit, exerciseMassUnit(exercise))}</span>
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

export interface DaysEditorProps {
  /** Opens the Programmes sheet — the empty state's "start from a preset". */
  onOpenProgrammes?: (section?: 'list' | 'presets') => void;
}

/**
 * Edit the active programme's days: add, rename, retag, reorder and delete the
 * days themselves, and rename, retarget, reorder, add, retire and swap the
 * exercises on the selected one. Everything is a soft change — logged sets are
 * never rewritten, so history keeps resolving old names.
 */
export function DaysEditor({ onOpenProgrammes }: DaysEditorProps = {}) {
  // Reads the programmes table too, so activating another programme swaps the
  // day tabs live without this screen knowing anything about it.
  const programme = useLiveQuery(() => readActiveProgramme().then((p) => p ?? null), []);
  // `undefined` until Dexie answers, so the empty state never flashes first.
  const dayRows = useLiveQuery(() => listTemplates(), []);
  const templates = dayRows ?? [];
  const [picked, setPicked] = useState<string>('');
  // Days are user-defined now, so there is no id to hard-code: the selection
  // falls back to the active programme's first day until one is chosen.
  const templateId: string =
    templates.find((t) => t.id === picked)?.id ?? templates[0]?.id ?? '';

  const exercises = useLiveQuery(
    () => (templateId ? listExercises(templateId) : Promise.resolve([])),
    [templateId],
    [],
  );
  // Only for a brand-new custom row: everything else keeps its own denomination.
  const settings = useLiveQuery(() => readSettings(), []);
  const defaultMassUnit: MassUnit = settings?.units === 'lb' ? 'lb' : 'kg';
  const archived = useLiveQuery(
    () =>
      templateId
        ? listExercises(templateId, true).then((rows) => rows.filter((e) => e.archived))
        : Promise.resolve([]),
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
  const [dayMode, setDayMode] = useState<'new' | 'edit' | null>(null);
  const [daySeq, setDaySeq] = useState(0);
  const [confirmDeleteDay, setConfirmDeleteDay] = useState(false);

  const day = templates.find((t) => t.id === templateId);
  const dayIndex = templates.findIndex((t) => t.id === templateId);

  const openDaySheet = (mode: 'new' | 'edit') => {
    setDaySeq((n) => n + 1);
    setDayMode(mode);
  };

  const saveDay = async (input: { name: string; tags: SplitTag[] }) => {
    if (dayMode === 'new') {
      if (!programme) return;
      const created = await createTemplate(programme.id, input);
      setPicked(created.id);
    } else if (day) {
      await updateTemplate(day.id, input);
    }
    setDayMode(null);
  };

  const moveDay = async (direction: -1 | 1) => {
    if (!programme) return;
    const target = dayIndex + direction;
    if (dayIndex < 0 || target < 0 || target >= templates.length) return;
    const ids = templates.map((t) => t.id);
    const moved = ids[dayIndex]!;
    ids[dayIndex] = ids[target]!;
    ids[target] = moved;
    await reorderTemplates(programme.id, ids);
  };

  const removeDay = async () => {
    setConfirmDeleteDay(false);
    setDayMode(null);
    if (!day) return;
    await archiveTemplate(day.id);
    // The selection falls back to the first remaining day on its own.
    setPicked('');
  };

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
      const incoming = await addExerciseFromCatalog(
        templateId,
        entry.id,
        swapOverrides(editing, entry),
      );
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
            increment: defaultIncrement(entry.defaultUnit, exerciseMassUnit(editing)),
          }
        : {}),
    });
    setFreshRow(saved);
    // Reseed the open sheet so it shows what is now stored.
    setSheetSeq((n) => n + 1);
  };

  if (dayRows === undefined) return null;

  if (templates.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-base text-fg">No days yet</p>
        <p className="mt-1 text-sm text-muted">
          A day is a name and its split tags; the exercises go on it next.
        </p>
        <div className="mx-auto mt-5 flex max-w-xs flex-col gap-3">
          <Button full disabled={!programme} onClick={() => openDaySheet('new')}>
            Add a day
          </Button>
          <Button full variant="secondary" onClick={() => onOpenProgrammes?.('presets')}>
            Start from a preset
          </Button>
        </div>

        <DaySheet
          key={`new:${daySeq}`}
          open={dayMode === 'new'}
          onSave={(input) => void saveDay(input)}
          onClose={() => setDayMode(null)}
        />
      </div>
    );
  }

  return (
    <div>
      {/* Lives here rather than in `Programme` so the empty state above, which
          has nothing to tap, never gets a line telling you to tap it. */}
      <p className="px-4 pb-2 text-xs text-muted">
        Tap an exercise to edit it. Changes apply to future sessions only.
      </p>

      <div className="flex items-center gap-2 px-4 pb-2">
        <SegmentedControl
          className="min-w-0 flex-1"
          label="Programme day"
          value={templateId}
          onChange={(value) => (value === ADD_DAY ? openDaySheet('new') : setPicked(value))}
          options={[
            ...templates.map((t) => ({ value: t.id, label: t.name })),
            { value: ADD_DAY, label: '+' },
          ]}
        />
        <IconButton
          label={`Edit ${day?.name ?? 'day'}`}
          disabled={!day}
          onClick={() => openDaySheet('edit')}
        >
          ✎
        </IconButton>
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
                      {formatPrescription(exercise)} ·{' '}
                      {unitLabel(exercise.unit, exerciseMassUnit(exercise))}
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
        defaultMassUnit={defaultMassUnit}
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
        onDismiss={() => setPendingLink(null)}
      />

      <DaySheet
        key={`${dayMode ?? 'closed'}:${templateId}:${daySeq}`}
        open={dayMode !== null}
        day={dayMode === 'edit' ? day : undefined}
        canMoveEarlier={dayIndex > 0}
        canMoveLater={dayIndex >= 0 && dayIndex < templates.length - 1}
        onMove={(direction) => void moveDay(direction)}
        onDelete={() => setConfirmDeleteDay(true)}
        onSave={(input) => void saveDay(input)}
        onClose={() => setDayMode(null)}
      />

      <ConfirmDialog
        open={confirmDeleteDay}
        title={`Delete ${day?.name ?? 'day'}?`}
        message={`Removes ${day?.name ?? 'this day'} from this programme and its rotation. Past sessions keep their history.`}
        confirmLabel="Delete day"
        onConfirm={() => void removeDay()}
        onCancel={() => setConfirmDeleteDay(false)}
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
