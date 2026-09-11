import { useLiveQuery } from 'dexie-react-hooks';
import { Sheet } from '../../components';
import { listExercises, listTemplates } from '../../db/repo';
import type { Exercise, TemplateId } from '../../db/types';
import { formatPrescription } from '../../logic/format';
import { unitLabel } from './exerciseForm';

export interface SwapSheetProps {
  open: boolean;
  templateId: TemplateId;
  /** The exercise being replaced. */
  current: Exercise | undefined;
  onClose: () => void;
  /** `archived` is true when the pick is a retired exercise from this template. */
  onChoose: (replacement: Exercise) => void;
}

interface Group {
  key: string;
  title: string;
  note: string;
  rows: Exercise[];
}

/**
 * Pick a replacement for `current`: either a retired exercise from this
 * template (brought back), or one that lives in another day (copied in).
 */
export function SwapSheet({ open, templateId, current, onClose, onChoose }: SwapSheetProps) {
  const templates = useLiveQuery(() => listTemplates(), [], []);
  const all = useLiveQuery(() => (open ? listExercises(undefined, true) : []), [open], []);

  const groups: Group[] = [];
  const archivedHere = all.filter((e) => e.templateId === templateId && e.archived);
  if (archivedHere.length) {
    groups.push({
      key: 'archived',
      title: 'Retired from this day',
      note: 'Brought back in place of the current exercise.',
      rows: archivedHere,
    });
  }
  for (const template of templates) {
    if (template.id === templateId) continue;
    const rows = all.filter((e) => e.templateId === template.id && !e.archived);
    if (!rows.length) continue;
    groups.push({
      key: template.id,
      title: template.name,
      note: 'Copied into this day; the original stays where it is.',
      rows,
    });
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Swap out ${current?.name ?? 'exercise'}`}>
      <p className="mb-3 text-xs text-muted">
        The current exercise is retired (its history is kept) and the one you pick takes its
        place in the list.
      </p>
      {groups.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Nothing to swap in yet.</p>
      ) : null}
      <div className="space-y-5">
        {groups.map((group) => (
          <section key={group.key}>
            <h3 className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">
              {group.title}
            </h3>
            <p className="mb-2 text-xs text-muted">{group.note}</p>
            <ul className="space-y-2">
              {group.rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => onChoose(row)}
                    className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2 text-left active:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base text-fg">{row.name}</span>
                      <span className="block text-xs text-muted">
                        {formatPrescription(row)} · {unitLabel(row.unit)}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-accent">Swap in</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Sheet>
  );
}

export default SwapSheet;
