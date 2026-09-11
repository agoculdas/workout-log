import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Sheet } from '../../components';
import { listCatalog, listExercises, listTemplates } from '../../db/repo';
import type { CatalogEntry, Exercise, SplitTag } from '../../db/types';
import { formatPrescription } from '../../logic/format';
import { unitLabel } from './exerciseForm';
import { CatalogFilters, CatalogRow } from './CatalogRow';
import { appearsInLabel, groupByCatalogId, templateNames, toggleFilter } from './libraryUtils';

export interface LibraryPickerSheetProps {
  open: boolean;
  title: string;
  /** One line above the list explaining what picking does. */
  note?: string;
  /** Right-hand label on each library row: "Add", "Swap in", "Link". */
  actionLabel?: string;
  /** Retired rows from this day, offered above the library (the swap flow). */
  retired?: Exercise[];
  onRestore?: (exercise: Exercise) => void;
  onChoose: (entry: CatalogEntry) => void;
  /** Adds the "Create custom" escape hatch at the bottom. */
  onCreateCustom?: () => void;
  onClose: () => void;
}

/**
 * Pick a movement from the library. Used for "Add exercise", for "Swap…" and
 * for re-pointing a programme row at a different library entry — the three
 * flows differ only in their labels and in what the caller does with the pick.
 */
export function LibraryPickerSheet({
  open,
  title,
  note,
  actionLabel = 'Add',
  retired,
  onRestore,
  onChoose,
  onCreateCustom,
  onClose,
}: LibraryPickerSheetProps) {
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<SplitTag | undefined>(undefined);

  const entries = useLiveQuery(
    () => (open ? listCatalog({ tag, query }) : Promise.resolve([])),
    [open, tag, query],
    [],
  );
  const templates = useLiveQuery(() => listTemplates(), [], []);
  const programme = useLiveQuery(
    () => (open ? listExercises() : Promise.resolve([])),
    [open],
    [],
  );

  const names = templateNames(templates);
  const byCatalogId = groupByCatalogId(programme);

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {note ? <p className="mb-3 text-xs text-muted">{note}</p> : null}

      {retired?.length ? (
        <section className="mb-4">
          <h3 className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">
            Retired from this day
          </h3>
          <p className="mb-2 text-xs text-muted">
            Brought back exactly as it was, in place of the current exercise.
          </p>
          <ul className="space-y-2">
            {retired.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => onRestore?.(row)}
                  className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2 text-left active:bg-surface-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base text-fg">{row.name}</span>
                    <span className="block text-xs text-muted">
                      {formatPrescription(row)} · {unitLabel(row.unit)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-accent">Restore</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <h3 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Library</h3>

      {/* Full-bleed so the chip rows can scroll to the sheet's edges. */}
      <div className="-mx-4">
        <CatalogFilters
          query={query}
          onQuery={setQuery}
          tag={tag}
          onTag={(value) => setTag((current) => toggleFilter(current, value))}
          placeholder="Search the library"
        />

        <ul className="mt-1 divide-y divide-border/60">
          {entries.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-muted">
              No library entries match.
            </li>
          ) : (
            entries.map((entry) => (
              <li key={entry.id}>
                <CatalogRow
                  entry={entry}
                  appearsIn={appearsInLabel(byCatalogId.get(entry.id), names)}
                  onClick={() => onChoose(entry)}
                  trailing={<span className="text-accent">{actionLabel}</span>}
                />
              </li>
            ))
          )}
        </ul>
      </div>

      {onCreateCustom ? (
        <div className="mt-3 border-t border-border/60 pt-3">
          <button
            type="button"
            onClick={onCreateCustom}
            className="min-h-11 text-sm text-muted underline underline-offset-4"
          >
            Create custom (not in library)
          </button>
        </div>
      ) : null}
    </Sheet>
  );
}

export default LibraryPickerSheet;
