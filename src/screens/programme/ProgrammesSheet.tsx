import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, ConfirmDialog, Sheet } from '../../components';
import {
  createProgramme,
  createProgrammeFromPreset,
  deleteProgramme,
  duplicateProgramme,
  listAllTemplates,
  listProgrammes,
  setActiveProgramme,
  updateProgramme,
} from '../../db/repo';
import { PRESETS } from '../../db/presets';
import type { Programme } from '../../db/types';
import { rotationShape } from '../../logic/days';
import { TextField, ToggleRow } from './Field';
import { dayCountLabel, daysOf, presetShape } from './rotationUtils';

export interface ProgrammesSheetProps {
  open: boolean;
  /** Opens scrolled to, and with, the preset list expanded. */
  initialSection?: 'list' | 'presets';
  onClose: () => void;
}

/**
 * The saved programmes: which one is active, and how to get another one.
 * Everything is edited in place — the only thing behind a confirm is delete,
 * and the active programme cannot be deleted at all.
 */
export function ProgrammesSheet({ open, initialSection = 'list', onClose }: ProgrammesSheetProps) {
  const programmes = useLiveQuery(() => (open ? listProgrammes() : Promise.resolve([])), [open], []);
  const templates = useLiveQuery(
    () => (open ? listAllTemplates() : Promise.resolve([])),
    [open],
    [],
  );

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<Programme | null>(null);
  const [showPresets, setShowPresets] = useState(initialSection === 'presets');
  const [activateNew, setActivateNew] = useState(false);
  const [blankName, setBlankName] = useState('');

  const startRename = (programme: Programme) => {
    setRenamingId(programme.id);
    setRenameDraft(programme.name);
  };

  const commitRename = async () => {
    const id = renamingId;
    setRenamingId(null);
    if (id) await updateProgramme(id, { name: renameDraft });
  };

  const remove = async () => {
    const target = confirmDelete;
    setConfirmDelete(null);
    if (target) await deleteProgramme(target.id);
  };

  const fromPreset = async (presetId: string) => {
    await createProgrammeFromPreset(presetId, { activate: activateNew });
  };

  const blank = async () => {
    const created = await createProgramme(blankName);
    setBlankName('');
    if (activateNew) await setActiveProgramme(created.id);
  };

  return (
    <>
      <Sheet open={open} onClose={onClose} title="Programmes">
        <ul className="space-y-2">
          {programmes.map((programme) => {
            const days = daysOf(programme, templates);
            const shape = rotationShape(programme, templates);
            return (
              <li
                key={programme.id}
                className="rounded-2xl border border-border/70 bg-surface-2/40 p-3"
              >
                {renamingId === programme.id ? (
                  <div className="space-y-3">
                    <TextField label="Name" value={renameDraft} onChange={setRenameDraft} />
                    <div className="flex gap-3">
                      <Button size="md" variant="secondary" full onClick={() => setRenamingId(null)}>
                        Cancel
                      </Button>
                      <Button size="md" full onClick={() => void commitRename()}>
                        Save name
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-base font-medium">
                        {programme.name}
                      </span>
                      {programme.active ? (
                        <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] tracking-wide text-accent uppercase">
                          Active
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs break-words text-muted">
                      {dayCountLabel(days)}
                      {shape ? ` · ${shape}` : ' · no rotation'}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {programme.active ? null : (
                        <Button
                          size="sm"
                          onClick={() => void setActiveProgramme(programme.id)}
                        >
                          Make active
                        </Button>
                      )}
                      <Button size="sm" variant="secondary" onClick={() => startRename(programme)}>
                        Rename
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          void duplicateProgramme(programme.id, `${programme.name} copy`)
                        }
                      >
                        Duplicate
                      </Button>
                      {programme.active ? (
                        <span className="self-center text-xs text-muted">
                          Make another programme active first
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setConfirmDelete(programme)}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>

        <div className="mt-5 border-t border-border/60 pt-4">
          <h3 className="text-sm font-semibold">New programme</h3>

          <div className="mt-3">
            <ToggleRow
              label="Make active now"
              hint="Applies to whatever you create below."
              checked={activateNew}
              onChange={setActivateNew}
            />
          </div>

          <button
            type="button"
            aria-expanded={showPresets}
            onClick={() => setShowPresets((v) => !v)}
            className="mt-3 min-h-11 text-sm text-muted underline underline-offset-4"
          >
            {showPresets ? 'Hide' : 'Show'} presets ({PRESETS.length})
          </button>

          {showPresets ? (
            <ul className="mt-1 divide-y divide-border/60 rounded-2xl border border-border/70">
              {PRESETS.map((preset) => (
                <li key={preset.id}>
                  <button
                    type="button"
                    onClick={() => void fromPreset(preset.id)}
                    className="w-full px-3 py-3 text-left active:bg-surface-2"
                  >
                    <span className="block text-base font-medium">{preset.name}</span>
                    <span className="mt-0.5 block text-xs text-muted">{preset.description}</span>
                    <span className="mt-0.5 block text-xs break-words text-muted/80">
                      {presetShape(preset)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-4 space-y-3">
            <TextField
              label="Blank programme"
              value={blankName}
              onChange={setBlankName}
              placeholder="PPL bulk"
            />
            <Button
              size="md"
              variant="secondary"
              full
              disabled={!blankName.trim()}
              onClick={() => void blank()}
            >
              Create blank programme
            </Button>
          </div>
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete ${confirmDelete?.name ?? 'programme'}?`}
        message="Its days and exercises are archived. Past sessions keep their history."
        confirmLabel="Delete"
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  );
}

export default ProgrammesSheet;
