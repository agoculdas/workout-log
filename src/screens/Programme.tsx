import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { PageHeader, SegmentedControl } from '../components';
import { readActiveProgramme } from '../db/repo';
import DaysEditor from './programme/DaysEditor';
import Library from './programme/Library';
import ProgrammesSheet from './programme/ProgrammesSheet';
import RotationEditor from './programme/RotationEditor';

type Segment = 'days' | 'rotation' | 'library';

const SEGMENT_KEY = 'programme.segment';

const SEGMENTS: { value: Segment; label: string }[] = [
  { value: 'days', label: 'Days' },
  { value: 'rotation', label: 'Rotation' },
  { value: 'library', label: 'Library' },
];

/**
 * The line under the segments. Days has one too, but it only makes sense once
 * there are exercises to tap, so `DaysEditor` renders its own and hides it
 * over the empty state.
 */
const HINTS: Record<Segment, string> = {
  days: '',
  rotation: '',
  library: 'Every movement the app knows, and what it trains.',
};

/** Last choice wins on the way back from an entry screen. Storage can throw. */
function readSegment(): Segment {
  try {
    const stored = localStorage.getItem(SEGMENT_KEY);
    return SEGMENTS.some((s) => s.value === stored) ? (stored as Segment) : 'days';
  } catch {
    return 'days';
  }
}

function writeSegment(segment: Segment): void {
  try {
    localStorage.setItem(SEGMENT_KEY, segment);
  } catch {
    // Private mode / storage disabled — the choice just does not stick.
  }
}

/**
 * The Programme tab: the active programme's days, its rotation, and the
 * exercise library. Which programme is active is a header line away — the
 * segments themselves never mention it twice.
 */
export function Programme() {
  const [segment, setSegment] = useState<Segment>(readSegment);
  const [programmes, setProgrammes] = useState<'list' | 'presets' | null>(null);

  // `undefined` while Dexie answers, `null` when there really is none — the
  // header line must not say "No programme" for a frame on every visit.
  const programme = useLiveQuery(() => readActiveProgramme().then((p) => p ?? null), []);

  const select = (next: Segment) => {
    setSegment(next);
    writeSegment(next);
  };

  const hint = HINTS[segment];

  return (
    <div>
      <PageHeader
        title="Programme"
        subtitle={
          <button
            type="button"
            aria-label={`Programme: ${programme?.name ?? 'none'}. Switch or edit programmes`}
            onClick={() => setProgrammes('list')}
            className="-mx-2 flex min-h-11 w-full items-center gap-1 rounded-xl px-2 text-left active:bg-surface-2"
          >
            <span className="min-w-0 truncate text-sm font-medium text-fg">
              {programme === undefined ? '' : (programme?.name ?? 'No programme')}
            </span>
            <span aria-hidden="true" className="shrink-0 text-muted">
              ›
            </span>
          </button>
        }
      />

      <div className="px-4 pt-1 pb-2">
        <SegmentedControl
          label="Programme view"
          options={SEGMENTS}
          value={segment}
          onChange={select}
        />
      </div>

      {hint ? <p className="px-4 pb-2 text-xs text-muted">{hint}</p> : null}

      {segment === 'days' ? (
        <DaysEditor onOpenProgrammes={(section) => setProgrammes(section ?? 'list')} />
      ) : segment === 'rotation' ? (
        <RotationEditor />
      ) : (
        <Library />
      )}

      <ProgrammesSheet
        key={programmes ?? 'closed'}
        open={programmes !== null}
        initialSection={programmes ?? 'list'}
        onClose={() => setProgrammes(null)}
      />
    </div>
  );
}

export default Programme;
