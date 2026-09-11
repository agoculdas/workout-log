import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, ConfirmDialog, PageHeader } from '../components';
import {
  archiveExercise,
  listExercises,
  listTemplates,
  reorderExercises,
  upsertExercise,
} from '../db/repo';
import type { Exercise, TemplateId } from '../db/types';
import { formatPrescription } from '../logic/format';
import ExerciseSheet from './programme/ExerciseSheet';
import SwapSheet from './programme/SwapSheet';
import {
  copyForTemplate,
  draftToInput,
  incrementLabel,
  unitLabel,
  type ExerciseDraft,
} from './programme/exerciseForm';

const TYPE_BADGE: Record<Exercise['type'], string> = {
  primary: 'bg-accent/15 text-accent',
  accessory: 'bg-surface-2 text-muted',
  conditioning: 'bg-surface-2 text-fg',
};

interface RowProps {
  exercise: Exercise;
  first: boolean;
  last: boolean;
  onEdit: () => void;
  onMove: (direction: -1 | 1) => void;
}

function ExerciseRow({ exercise, first, last, onEdit, onMove }: RowProps) {
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
export function Programme() {
  const templates = useLiveQuery(() => listTemplates(), [], []);
  const [templateId, setTemplateId] = useState<TemplateId>('lowerA');

  const exercises = useLiveQuery(() => listExercises(templateId), [templateId], []);
  const archived = useLiveQuery(
    () => listExercises(templateId, true).then((rows) => rows.filter((e) => e.archived)),
    [templateId],
    [],
  );

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetSeq, setSheetSeq] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const editing = editingId ? exercises.find((e) => e.id === editingId) : undefined;

  const openSheet = (id: string | null) => {
    setEditingId(id);
    setSheetSeq((n) => n + 1);
    setSheetOpen(true);
  };

  const closeSheet = () => {
    setSheetOpen(false);
    setEditingId(null);
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

  const swap = async (replacement: Exercise) => {
    if (!editing) return;
    const outgoing = editing;
    let incomingId = replacement.id;

    if (replacement.templateId === templateId) {
      // Retired from this day: just bring it back.
      await archiveExercise(replacement.id, false);
    } else {
      // Lives elsewhere: copy it in, leaving the original where it is.
      const copy = await upsertExercise(
        copyForTemplate(replacement, templateId, outgoing.order),
      );
      incomingId = copy.id;
    }
    await archiveExercise(outgoing.id);
    await reorderExercises(
      templateId,
      exercises.map((e) => (e.id === outgoing.id ? incomingId : e.id)),
    );

    setSwapOpen(false);
    closeSheet();
  };

  return (
    <div>
      <PageHeader
        title="Programme"
        subtitle="Tap an exercise to edit it. Changes apply to future sessions only."
      />

      <div className="px-4 pt-1 pb-2">
        <div
          role="tablist"
          aria-label="Programme day"
          className="grid grid-cols-4 gap-1 rounded-xl border border-border/70 bg-surface p-1"
        >
          {templates.map((template) => {
            const active = template.id === templateId;
            return (
              <button
                key={template.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTemplateId(template.id)}
                className={[
                  'min-h-11 rounded-lg px-1 text-xs font-medium transition-colors',
                  active ? 'bg-accent text-[#14200a]' : 'text-muted active:bg-surface-2',
                ].join(' ')}
              >
                {template.name}
              </button>
            );
          })}
        </div>
      </div>

      <ul className="mt-2 border-y border-border/60 bg-surface/40">
        {exercises.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-muted">
            No exercises on this day yet.
          </li>
        ) : (
          exercises.map((exercise, index) => (
            <ExerciseRow
              key={exercise.id}
              exercise={exercise}
              first={index === 0}
              last={index === exercises.length - 1}
              onEdit={() => openSheet(exercise.id)}
              onMove={(direction) => void move(index, direction)}
            />
          ))
        )}
      </ul>

      <div className="px-4 pt-4">
        <Button full variant="secondary" onClick={() => openSheet(null)}>
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
        onClose={closeSheet}
        onSave={save}
        onDelete={() => setConfirmDelete(true)}
        onSwap={() => setSwapOpen(true)}
      />

      <SwapSheet
        open={swapOpen}
        templateId={templateId}
        current={editing}
        onClose={() => setSwapOpen(false)}
        onChoose={(replacement) => void swap(replacement)}
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

export default Programme;
