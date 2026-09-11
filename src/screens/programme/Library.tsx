import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '../../components';
import { listCatalog, listExercises, listTemplates } from '../../db/repo';
import { MUSCLES, type Muscle, type SplitTag } from '../../db/types';
import { CatalogFilters, CatalogRow, Chevron } from './CatalogRow';
import CatalogEntrySheet from './CatalogEntrySheet';
import { appearsInLabel, groupByCatalogId, templateNames, toggleFilter } from './libraryUtils';

/**
 * The exercise library: every movement the app knows about, filterable by
 * split tag, muscle and name. Rows open the entry screen; the sheet here only
 * ever creates a new entry.
 */
export function Library() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<SplitTag | undefined>(undefined);
  const [muscle, setMuscle] = useState<Muscle | undefined>(undefined);
  const [showRetired, setShowRetired] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [newSeq, setNewSeq] = useState(0);

  const entries = useLiveQuery(
    () => listCatalog({ tag, muscle, query, includeArchived: showRetired }),
    [tag, muscle, query, showRetired],
    [],
  );
  const retiredCount = useLiveQuery(
    () => listCatalog({ includeArchived: true }).then((rows) => rows.filter((r) => r.archived).length),
    [],
    0,
  );
  const templates = useLiveQuery(() => listTemplates(), [], []);
  // One read for every row's "in Lower A, Lower B" hint, grouped in memory.
  const programme = useLiveQuery(() => listExercises(), [], []);

  const names = templateNames(templates);
  const byCatalogId = groupByCatalogId(programme);
  const filtered = Boolean(query.trim() || tag || muscle);

  return (
    <div>
      <CatalogFilters
        query={query}
        onQuery={setQuery}
        tag={tag}
        onTag={(value) => setTag((current) => toggleFilter(current, value))}
        muscle={muscle}
        onMuscle={(value) => setMuscle((current) => toggleFilter(current, value))}
        muscles={MUSCLES}
      />

      <div className="flex items-center gap-3 px-4 pt-2">
        <p className="min-w-0 flex-1 text-xs text-muted">
          {entries.length} movement{entries.length === 1 ? '' : 's'}
          {filtered ? ' match' : ''}
        </p>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setNewSeq((n) => n + 1);
            setNewOpen(true);
          }}
        >
          + New entry
        </Button>
      </div>

      <ul className="mt-2 divide-y divide-border/60 border-y border-border/60 bg-surface/40">
        {entries.length === 0 ? (
          <li className="px-4 py-10 text-center text-sm text-muted">
            {filtered
              ? 'Nothing matches those filters. Clear one, or add a new entry.'
              : 'The library is empty. Add your first movement.'}
          </li>
        ) : (
          entries.map((entry) => (
            <li key={entry.id}>
              <CatalogRow
                entry={entry}
                appearsIn={appearsInLabel(byCatalogId.get(entry.id), names)}
                onClick={() => void navigate(`/programme/library/${entry.id}`)}
                trailing={<Chevron />}
              />
            </li>
          ))
        )}
      </ul>

      <div className="px-4 pt-4 pb-4">
        <button
          type="button"
          onClick={() => setShowRetired((v) => !v)}
          className="min-h-11 text-sm text-muted underline underline-offset-4"
          aria-pressed={showRetired}
        >
          {showRetired ? 'Hide' : 'Show'} retired ({retiredCount})
        </button>
      </div>

      <CatalogEntrySheet
        key={`new:${newSeq}`}
        open={newOpen}
        entry={undefined}
        onClose={() => setNewOpen(false)}
        onSaved={(entry) => void navigate(`/programme/library/${entry.id}`)}
      />
    </div>
  );
}

export default Library;
