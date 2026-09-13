import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Card } from '../../components';
import { getAllRecords, type ExerciseRecordRow } from '../../db/repo';
import { formatDate } from '../../logic/format';
import {
  formatRecord,
  recordKindsFor,
  type RecordEntry,
  type RecordKind,
} from '../../logic/records';

/** The records worth putting on a row: the top two, primary first. */
function topRecords(row: ExerciseRecordRow): Array<[RecordKind, RecordEntry]> {
  const pairs: Array<[RecordKind, RecordEntry]> = [];
  for (const kind of recordKindsFor(row.exercise)) {
    const entry = row.records[kind];
    if (entry) pairs.push([kind, entry]);
  }
  return pairs.slice(0, 2);
}

interface RecordGroup {
  key: string;
  label: string;
  rows: ExerciseRecordRow[];
}

/** Consecutive rows sharing a heading, in the order the repo returned them. */
function groupRuns(
  rows: ExerciseRecordRow[],
  label: (row: ExerciseRecordRow) => string,
): RecordGroup[] {
  const out: RecordGroup[] = [];
  for (const row of rows) {
    const next = label(row);
    const last = out[out.length - 1];
    if (last && last.label === next) last.rows.push(row);
    else out.push({ key: `${next}:${out.length}`, label: next, rows: [row] });
  }
  return out;
}

/**
 * History → Records: your best numbers per exercise, the programme you are
 * running first and the ones you have kept behind a fold. Facts only — a
 * record is what you did, never an instruction for what to do next.
 */
export function RecordsSection() {
  const rows = useLiveQuery(() => getAllRecords(), []);
  const [othersOpen, setOthersOpen] = useState(false);

  if (rows === undefined) {
    return <p className="px-4 py-6 text-sm text-muted">Loading…</p>;
  }

  if (!rows.length) {
    return (
      <div className="px-4 pb-8">
        <Card className="text-sm text-muted">
          No records yet — finish a session to start one.
        </Card>
      </div>
    );
  }

  const days = groupRuns(
    rows.filter((row) => row.activeProgramme),
    (row) => row.templateName,
  );
  const others = groupRuns(
    rows.filter((row) => !row.activeProgramme),
    (row) => row.programmeName,
  );

  return (
    <div className="px-4 pb-8">
      <div className="space-y-4">
        {days.map((group) => (
          <RecordGroupSection key={group.key} group={group} />
        ))}
      </div>

      {others.length ? (
        <div className="mt-4">
          <button
            type="button"
            aria-expanded={othersOpen}
            onClick={() => setOthersOpen((v) => !v)}
            className="flex min-h-12 w-full items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase"
          >
            Other programmes
            <span className="flex-1 border-t border-border/60" />
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className={[
                'h-4 w-4 shrink-0 transition-transform',
                othersOpen ? 'rotate-180' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 9l6 6 6-6"
              />
            </svg>
          </button>
          {othersOpen ? (
            <div className="mt-2 space-y-4">
              {others.map((group) => (
                <RecordGroupSection key={group.key} group={group} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** One day (or one retired programme) and the records under it. */
function RecordGroupSection({ group }: { group: RecordGroup }) {
  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold">{group.label}</h2>
      <Card flush>
        <ul className="divide-y divide-border/60">
          {group.rows.map((row) => (
            <RecordRow key={row.exercise.id} row={row} />
          ))}
        </ul>
      </Card>
    </section>
  );
}

/** One exercise: its name, its top two records, and when the first was set. */
function RecordRow({ row }: { row: ExerciseRecordRow }) {
  const top = topRecords(row);
  const primary = top[0];

  return (
    <li>
      <Link
        to={`/history/${row.exercise.id}`}
        className="flex min-h-14 items-center gap-3 px-4 py-2 active:bg-surface-2"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{row.exercise.name}</span>
          <span className="block truncate text-xs text-accent tabular-nums">
            {top.map(([kind, entry]) => formatRecord(row.exercise, kind, entry)).join(' · ')}
          </span>
        </span>
        {primary ? (
          <span className="shrink-0 text-xs text-muted">{formatDate(primary[1].at)}</span>
        ) : null}
      </Link>
    </li>
  );
}

export default RecordsSection;
