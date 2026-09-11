import type { ReactNode } from 'react';
import type { CatalogEntry, Muscle, SplitTag } from '../../db/types';
import { MUSCLE_LABELS, SPLIT_TAG_LABELS } from '../../db/labels';
import { Chip } from '../../components';
import { entryMeta, muscleSummary, TAG_FILTER_GROUPS } from './libraryUtils';

export interface CatalogRowProps {
  entry: CatalogEntry;
  /** "in Lower A, Lower B", or '' when the movement is on no day. */
  appearsIn?: string;
  onClick: () => void;
  /** Right-hand affordance: a chevron in the list, "Add" in the picker. */
  trailing?: ReactNode;
}

/**
 * One catalogue entry as a list row: name, what it trains, how it is loaded
 * and where it already sits in the programme. Shared by the Library list and
 * the picker sheet so both read identically.
 */
export function CatalogRow({ entry, appearsIn, onClick, trailing }: CatalogRowProps) {
  const { primary, secondary } = muscleSummary(entry);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-surface-2"
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-base font-medium text-fg">
            {entry.name}
          </span>
          {entry.archived ? (
            <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] tracking-wide text-muted uppercase">
              Retired
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-xs">
          <span className="font-medium text-fg">{primary || '—'}</span>
          {secondary ? <span className="text-muted"> · {secondary}</span> : null}
        </span>
        <span className="mt-0.5 block truncate text-[11px]">
          <span className="text-muted">{entryMeta(entry)}</span>
          {appearsIn ? <span className="text-accent"> · {appearsIn}</span> : null}
        </span>
      </span>
      {trailing ? <span className="shrink-0 text-xs text-muted">{trailing}</span> : null}
    </button>
  );
}

/** The ">" affordance on rows that open the entry detail screen. */
export function Chevron() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 5l7 7-7 7"
      />
    </svg>
  );
}

export interface CatalogFiltersProps {
  query: string;
  onQuery: (value: string) => void;
  tag: SplitTag | undefined;
  onTag: (tag: SplitTag) => void;
  /** Omit to hide the muscle row (the picker sheet keeps it to one row). */
  muscle?: Muscle | undefined;
  onMuscle?: (muscle: Muscle) => void;
  muscles?: readonly Muscle[];
  placeholder?: string;
}

/**
 * Search box plus the two filter rows: split tags, then muscles. Both rows
 * scroll sideways inside their own container so the page never does.
 */
export function CatalogFilters({
  query,
  onQuery,
  tag,
  onTag,
  muscle,
  onMuscle,
  muscles,
  placeholder = 'Search exercises',
}: CatalogFiltersProps) {
  return (
    <div className="space-y-2">
      <div className="relative px-4">
        <input
          type="text"
          enterKeyHint="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={placeholder}
          aria-label="Search the exercise library"
          className="h-12 w-full rounded-xl border border-border bg-surface pr-11 pl-3 text-base text-fg outline-none focus:border-accent"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onQuery('')}
            className="absolute top-0 right-4 flex h-12 w-11 items-center justify-center text-muted active:text-fg"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                d="M6 6l12 12M18 6L6 18"
              />
            </svg>
          </button>
        ) : null}
      </div>

      <div className="[scrollbar-width:none] overflow-x-auto px-4 pb-1 [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max items-center gap-2">
          {TAG_FILTER_GROUPS.map((group, index) => (
            <div key={group.key} className="flex items-center gap-2">
              {index > 0 ? (
                <span aria-hidden="true" className="px-0.5 text-xs text-border">
                  ·
                </span>
              ) : null}
              {group.tags.map((value) => (
                <Chip
                  key={value}
                  label={SPLIT_TAG_LABELS[value]}
                  selected={tag === value}
                  onClick={() => onTag(value)}
                >
                  {SPLIT_TAG_LABELS[value]}
                </Chip>
              ))}
            </div>
          ))}
        </div>
      </div>

      {muscles && onMuscle ? (
        <div className="[scrollbar-width:none] overflow-x-auto px-4 pb-1 [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max items-center gap-2">
            {muscles.map((value) => (
              <Chip
                key={value}
                label={MUSCLE_LABELS[value]}
                selected={muscle === value}
                onClick={() => onMuscle(value)}
              >
                {MUSCLE_LABELS[value]}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default CatalogRow;
