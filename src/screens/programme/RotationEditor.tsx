import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, IconButton, Sheet } from '../../components';
import { listTemplates, readActiveProgramme, updateProgramme } from '../../db/repo';
import type { RotationSlot, Template } from '../../db/types';
import { dayKindLabel, rotationShape } from '../../logic/days';
import {
  addDaySlot,
  addRestSlot,
  isRest,
  moveSlot,
  removeSlot,
  rotationSummary,
} from './rotationUtils';

interface SlotRowProps {
  position: number;
  day?: Template;
  first: boolean;
  last: boolean;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}

function SlotRow({ position, day, first, last, onMove, onRemove }: SlotRowProps) {
  const name = day ? day.name : 'Rest';
  return (
    <li className="flex min-h-14 items-center gap-2 border-b border-border/60 px-4 py-2 last:border-b-0">
      <span className="w-5 shrink-0 text-sm tabular-nums text-muted">{position}</span>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className={['min-w-0 truncate text-base', day ? 'text-fg' : 'text-muted'].join(' ')}>
          {name}
        </span>
        {day ? (
          <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] tracking-wide text-muted uppercase">
            {dayKindLabel(day)}
          </span>
        ) : null}
      </span>
      <IconButton label={`Move ${name} at position ${position} up`} disabled={first} onClick={() => onMove(-1)}>
        ▲
      </IconButton>
      <IconButton label={`Move ${name} at position ${position} down`} disabled={last} onClick={() => onMove(1)}>
        ▼
      </IconButton>
      <IconButton
        label={`Remove ${name} at position ${position}`}
        variant="danger"
        onClick={onRemove}
      >
        ✕
      </IconButton>
    </li>
  );
}

/**
 * The active programme's rotation: an ordered list of training days and rest
 * days, walked and wrapped by `pickNextSession`. Every edit writes straight
 * through — there is no save button and no edit mode anywhere in Programme.
 */
export function RotationEditor() {
  // `undefined` is "Dexie has not answered yet", `null` is "there is none" —
  // without the distinction the first paint claims the programme is missing.
  const programme = useLiveQuery(() => readActiveProgramme().then((p) => p ?? null), []);
  const templates = useLiveQuery(() => listTemplates(), [], []);
  const [pickerOpen, setPickerOpen] = useState(false);

  const rotation: RotationSlot[] = programme?.rotation ?? [];
  const byId = new Map(templates.map((t) => [t.id, t]));

  const write = async (next: RotationSlot[]) => {
    if (!programme) return;
    await updateProgramme(programme.id, { rotation: next });
  };

  if (programme === undefined) return null;
  if (programme === null) {
    return <p className="px-4 py-8 text-center text-sm text-muted">No programme yet.</p>;
  }

  return (
    <div>
      <div className="px-4 pb-3">
        {rotation.length === 0 ? (
          <p className="text-sm text-muted">Empty rotation — Today will offer the first day.</p>
        ) : (
          <>
            <p className="text-base break-words text-fg">{rotationShape(programme, templates)}</p>
            <p className="mt-0.5 text-xs text-muted">{rotationSummary(rotation, templates)}</p>
          </>
        )}
      </div>

      {rotation.length ? (
        <ul className="border-y border-border/60 bg-surface/40">
          {rotation.map((slot, index) => {
            const day = isRest(slot) ? undefined : byId.get(slot.templateId);
            return (
              <SlotRow
                key={index}
                position={index + 1}
                day={day}
                first={index === 0}
                last={index === rotation.length - 1}
                onMove={(direction) => void write(moveSlot(rotation, index, direction))}
                onRemove={() => void write(removeSlot(rotation, index))}
              />
            );
          })}
        </ul>
      ) : null}

      <div className="flex gap-3 px-4 pt-4 pb-4">
        <Button
          full
          variant="secondary"
          disabled={templates.length === 0}
          onClick={() => setPickerOpen(true)}
        >
          Add day…
        </Button>
        <Button full variant="secondary" onClick={() => void write(addRestSlot(rotation))}>
          Add rest
        </Button>
      </div>

      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} title="Add a day">
        <ul className="divide-y divide-border/60">
          {templates.map((template) => (
            <li key={template.id}>
              <button
                type="button"
                onClick={() => {
                  setPickerOpen(false);
                  void write(addDaySlot(rotation, template.id));
                }}
                className="flex min-h-14 w-full items-center gap-2 text-left active:bg-surface-2"
              >
                <span className="min-w-0 flex-1 truncate text-base text-fg">{template.name}</span>
                <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] tracking-wide text-muted uppercase">
                  {dayKindLabel(template)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </div>
  );
}

export default RotationEditor;
