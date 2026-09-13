import { useEffect, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, Sheet } from '../../components';
import { MUSCLE_LABELS } from '../../db/labels';
import {
  addExerciseFromCatalog,
  getCatalogEntriesByIds,
  listCatalog,
  listExercises,
  listTemplates,
} from '../../db/repo';
import type { CatalogEntry, Muscle, Template } from '../../db/types';
import {
  candidateEntries,
  classifyMuscles,
  formatBasis,
  formatInRange,
  formatMovementsLabel,
  formatReviewRow,
  muscleCoverage,
  MOVEMENT_SUGGESTIONS,
  splitByProgramme,
  type ReviewRow,
  type SetsTarget,
} from './review';

/**
 * History → Muscles → "Review this window".
 *
 * On demand only, and it never acts on its own: it says which muscles fell
 * outside the band over the selected window, and — for the ones that came up
 * short — offers the library entries that would train them, with an explicit
 * "Add to day…". Nothing is added, reordered or suggested anywhere else.
 */
export interface ReviewSheetProps {
  open: boolean;
  onClose: () => void;
  /** Every muscle's weighted sets per active week, as the chart has them. */
  rows: ReviewRow[];
  /** `settings.setsPerMuscleTarget`. */
  target: SetsTarget;
  /** Weeks in the window that actually trained — what the averages divide by. */
  activeWeeks: number;
  /** "Last 4 weeks" — the window chip that was selected. */
  windowLabel: string;
}

/** What the active programme already runs — read once when the sheet opens. */
interface ProgrammeContext {
  days: Template[];
  /** Catalogue ids already on a day, so the movement lists skip them. */
  excludeIds: string[];
  /** Muscles those entries train, primary or secondary. */
  covered: Set<Muscle>;
}

export function ReviewSheet({
  open,
  onClose,
  rows,
  target,
  activeWeeks,
  windowLabel,
}: ReviewSheetProps) {
  // A snapshot, deliberately not a live query: adding an exercise must not
  // pull the row you just used out from under your thumb.
  const [programme, setProgramme] = useState<ProgrammeContext | undefined>(undefined);

  // Drop the snapshot as the sheet closes, so reopening never shows a
  // programme that has since changed. Render-phase, not an effect.
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (!open) setProgramme(undefined);
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const [days, exercises] = await Promise.all([listTemplates(), listExercises()]);
      const excludeIds = [
        ...new Set(exercises.map((e) => e.catalogId).filter((id): id is string => !!id)),
      ];
      const catalog = await getCatalogEntriesByIds(excludeIds);
      if (cancelled) return;
      setProgramme({ days, excludeIds, covered: muscleCoverage(catalog.values()) });
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const { under, over, inRange } = classifyMuscles(rows, target);
  const split = splitByProgramme(under, programme?.covered ?? []);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Review · ${windowLabel.toLowerCase()}`}
      footer={
        <Button variant="secondary" full onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="min-w-0 space-y-5">
        {programme === undefined ? <p className="text-sm text-muted">Loading…</p> : null}

        {programme && under.length ? (
          <section className="min-w-0">
            <Heading>Under</Heading>
            {split.inProgramme.length ? (
              <UnderGroup
                label="In your programme"
                rows={split.inProgramme}
                target={target}
                movementsFor={split.inProgramme.length}
                programme={programme}
              />
            ) : null}
            {split.notInProgramme.length ? (
              <Collapsed
                label={`Not in your programme (${split.notInProgramme.length})`}
                className={split.inProgramme.length ? 'mt-3' : ''}
              >
                <UnderGroup
                  rows={split.notInProgramme}
                  target={target}
                  movementsFor={MOVEMENT_SUGGESTIONS}
                  programme={programme}
                />
              </Collapsed>
            ) : null}
          </section>
        ) : null}

        {programme && over.length ? (
          <section className="min-w-0">
            <Heading>Over</Heading>
            <ul className="space-y-1">
              {over.map((row) => (
                <li key={row.muscle} className="text-sm break-words">
                  {formatReviewRow(row, target)}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {programme ? <p className="text-sm text-muted">{formatInRange(inRange.length)}</p> : null}

        <p className="text-xs text-muted">{formatBasis(activeWeeks)}</p>
      </div>
    </Sheet>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">{children}</h3>
  );
}

/**
 * One under-target list. The first `movementsFor` rows carry a movement
 * disclosure — all of them for muscles the programme already trains, the worst
 * few for the ones it does not.
 */
function UnderGroup({
  label,
  rows,
  target,
  movementsFor,
  programme,
}: {
  label?: string;
  rows: ReviewRow[];
  target: SetsTarget;
  movementsFor: number;
  programme: ProgrammeContext;
}) {
  return (
    <div className="min-w-0">
      {label ? <p className="mb-1 text-xs text-muted">{label}</p> : null}
      <ul className="divide-y divide-border/50">
        {rows.map((row, index) => (
          <li key={row.muscle} className="min-w-0 py-1.5">
            <span className="text-sm break-words">{formatReviewRow(row, target)}</span>
            {index < movementsFor ? (
              <Movements muscle={row.muscle} programme={programme} />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Movements for rear delts" — the library entries you are not already running. */
function Movements({
  muscle,
  programme,
}: {
  muscle: Muscle;
  programme: ProgrammeContext;
}) {
  const [open, setOpen] = useState(false);
  // Only hits the catalogue once the row is opened.
  const entries = useLiveQuery(
    async () => (open ? await listCatalog({ muscle }) : undefined),
    [open, muscle],
  );
  const candidates = entries && candidateEntries(entries, muscle, programme.excludeIds);

  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="min-h-11 text-sm text-accent underline-offset-2 active:underline"
      >
        {formatMovementsLabel(muscle)}
      </button>
      {open ? (
        candidates === undefined ? (
          <p className="pb-2 text-sm text-muted">Loading…</p>
        ) : candidates.length ? (
          <ul className="mb-2 divide-y divide-border/50 rounded-xl bg-surface-2 px-3">
            {candidates.map((entry) => (
              <MovementRow key={entry.id} entry={entry} days={programme.days} />
            ))}
          </ul>
        ) : (
          <p className="pb-2 text-sm text-muted">
            Nothing in the library for this that you are not already running.
          </p>
        )
      ) : null}
    </div>
  );
}

/** "Glutes, hamstrings" — what the entry trains directly. */
function primaryMuscles(entry: CatalogEntry): string {
  return (entry.primary ?? [])
    .map((muscle, i) => (i === 0 ? MUSCLE_LABELS[muscle] : MUSCLE_LABELS[muscle].toLowerCase()))
    .join(', ');
}

/** One library entry, with the day picker folded away until asked for. */
function MovementRow({ entry, days }: { entry: CatalogEntry; days: Template[] }) {
  const [picking, setPicking] = useState(false);
  const [added, setAdded] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  // The picker stays up until the write lands, so the row never flickers back
  // to "Add to day…" on its way to the confirmation.
  async function add(day: Template) {
    setFailed(false);
    try {
      await addExerciseFromCatalog(day.id, entry.id);
      setAdded(day.name);
    } catch {
      setFailed(true);
    }
    setPicking(false);
  }

  return (
    <li className="min-w-0 py-2">
      <div className="min-w-0 text-sm break-words">{entry.name}</div>
      {primaryMuscles(entry) ? (
        <div className="min-w-0 text-xs break-words text-muted">{primaryMuscles(entry)}</div>
      ) : null}

      {added ? (
        <p className="mt-0.5 text-xs text-muted">Added to {added}</p>
      ) : picking ? (
        <div className="mt-1 flex flex-wrap gap-2">
          {days.map((day) => (
            <Button key={day.id} variant="secondary" size="sm" onClick={() => void add(day)}>
              {day.name}
            </Button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setPicking(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <button
          type="button"
          disabled={!days.length}
          onClick={() => setPicking(true)}
          className="min-h-11 text-sm text-accent underline-offset-2 active:underline disabled:text-muted disabled:no-underline"
        >
          {days.length ? 'Add to day…' : 'No days to add to'}
        </button>
      )}
      {failed ? <p className="text-xs text-muted">Could not add that one.</p> : null}
    </li>
  );
}

/** A group that starts folded away, e.g. the muscles your programme skips. */
function Collapsed({
  label,
  className = '',
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`min-w-0 ${className}`.trim()}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="min-h-11 text-sm text-accent underline-offset-2 active:underline"
      >
        {label}
      </button>
      {open ? children : null}
    </div>
  );
}

export default ReviewSheet;
