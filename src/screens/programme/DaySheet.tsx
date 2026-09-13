import { useState } from 'react';
import { Button, Chip, Sheet } from '../../components';
import { SPLIT_TAG_GROUP_LABELS, SPLIT_TAG_LABELS } from '../../db/labels';
import type { SplitTag, Template } from '../../db/types';
import { dayKindLabel } from '../../logic/days';
import { FieldLabel, TextField } from './Field';
import { TAG_FILTER_GROUPS } from './libraryUtils';

export interface DaySheetProps {
  open: boolean;
  /** The day being edited, or undefined to add one. */
  day?: Template;
  /** Reorder controls, shown only when editing. */
  canMoveEarlier?: boolean;
  canMoveLater?: boolean;
  onMove?: (direction: -1 | 1) => void;
  onDelete?: () => void;
  onSave: (input: { name: string; tags: SplitTag[] }) => void;
  onClose: () => void;
}

function toggle(tags: SplitTag[], tag: SplitTag): SplitTag[] {
  return tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
}

/**
 * Add or edit one programme day: its name and its split tags. The tags are not
 * decoration — they are what `dayKindLabel` reads for the rotation strip and
 * what the clash rule compares, so the sheet shows the resulting reading live.
 */
export function DaySheet({
  open,
  day,
  canMoveEarlier = false,
  canMoveLater = false,
  onMove,
  onDelete,
  onSave,
  onClose,
}: DaySheetProps) {
  const [name, setName] = useState(day?.name ?? '');
  const [tags, setTags] = useState<SplitTag[]>(day?.tags ?? []);

  const trimmed = name.trim();

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={day ? `Edit ${day.name}` : 'Add a day'}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" full onClick={onClose}>
            Cancel
          </Button>
          <Button full disabled={!trimmed} onClick={() => onSave({ name: trimmed, tags })}>
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <TextField label="Name" value={name} onChange={setName} placeholder="Lower A" />

        <div>
          <FieldLabel>Split tags</FieldLabel>
          <div className="space-y-3">
            {TAG_FILTER_GROUPS.map((group) => (
              <div key={group.key}>
                <p className="mb-1 text-[11px] text-muted">{SPLIT_TAG_GROUP_LABELS[group.key]}</p>
                <div className="flex flex-wrap gap-2">
                  {group.tags.map((tag) => (
                    <Chip
                      key={tag}
                      label={SPLIT_TAG_LABELS[tag]}
                      selected={tags.includes(tag)}
                      onClick={() => setTags((current) => toggle(current, tag))}
                    >
                      {SPLIT_TAG_LABELS[tag]}
                    </Chip>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            Reads as: <span className="text-fg">{dayKindLabel({ tags })}</span>
          </p>
        </div>

        {day && onMove ? (
          <div>
            <FieldLabel>Position</FieldLabel>
            <div className="flex gap-3">
              <Button
                size="md"
                variant="secondary"
                full
                disabled={!canMoveEarlier}
                onClick={() => onMove(-1)}
              >
                Move earlier
              </Button>
              <Button
                size="md"
                variant="secondary"
                full
                disabled={!canMoveLater}
                onClick={() => onMove(1)}
              >
                Move later
              </Button>
            </div>
          </div>
        ) : null}

        {day && onDelete ? (
          <div className="border-t border-border/60 pt-4">
            <Button size="md" variant="danger" full onClick={onDelete}>
              Delete day
            </Button>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

export default DaySheet;
