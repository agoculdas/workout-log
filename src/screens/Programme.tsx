import { useState } from 'react';
import { PageHeader, SegmentedControl } from '../components';
import DaysEditor from './programme/DaysEditor';
import Library from './programme/Library';

type Segment = 'days' | 'library';

const SEGMENT_KEY = 'programme.segment';

const SEGMENTS: { value: Segment; label: string }[] = [
  { value: 'days', label: 'Days' },
  { value: 'library', label: 'Library' },
];

const SUBTITLES: Record<Segment, string> = {
  days: 'Tap an exercise to edit it. Changes apply to future sessions only.',
  library: 'Every movement the app knows, and what it trains.',
};

/** Last choice wins on the way back from an entry screen. Storage can throw. */
function readSegment(): Segment {
  try {
    return localStorage.getItem(SEGMENT_KEY) === 'library' ? 'library' : 'days';
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

/** The two halves of the Programme tab: the four days, and the exercise library. */
export function Programme() {
  const [segment, setSegment] = useState<Segment>(readSegment);

  const select = (next: Segment) => {
    setSegment(next);
    writeSegment(next);
  };

  return (
    <div>
      <PageHeader title="Programme" subtitle={SUBTITLES[segment]} />

      <div className="px-4 pt-1 pb-2">
        <SegmentedControl
          label="Programme view"
          options={SEGMENTS}
          value={segment}
          onChange={select}
        />
      </div>

      {segment === 'days' ? <DaysEditor /> : <Library />}
    </div>
  );
}

export default Programme;
