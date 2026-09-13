import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, Card, Chip, ConfirmDialog, PageHeader, Sheet } from '../../components';
import {
  addExerciseFromCatalog,
  archiveCatalogEntry,
  getCatalogEntry,
  listExercisesForCatalog,
  listTemplates,
} from '../../db/repo';
import type { TemplateId } from '../../db/types';
import { EQUIPMENT_LABELS, PATTERN_LABELS, SPLIT_TAG_LABELS } from '../../db/labels';
import { formatPrescription } from '../../logic/format';
import { exerciseMassUnit } from '../../logic/units';
import { MEASURE_OPTIONS, UNIT_OPTIONS, unitLabel } from './exerciseForm';
import CatalogEntrySheet from './CatalogEntrySheet';
import { muscleList, sortMuscles, templateNames } from './libraryUtils';

function optionLabel(options: { value: string; label: string }[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-border/50 py-2 last:border-b-0">
      <span className="w-32 shrink-0 text-xs tracking-wide text-muted uppercase">{label}</span>
      <span className="min-w-0 flex-1 text-sm text-fg">{children}</span>
    </div>
  );
}

/**
 * One library movement in full: what it trains, how it loads, where it sits in
 * the programme, and the four things you can do to it — add it to a day, edit
 * it, retire it, bring it back.
 */
export function CatalogEntryScreen() {
  const { id } = useParams<{ id: string }>();

  // `undefined` means "still loading", `null` means "no such entry" — a bare
  // `getCatalogEntry` cannot tell the two apart.
  const entry = useLiveQuery(
    async () => (id ? ((await getCatalogEntry(id)) ?? null) : null),
    [id],
  );
  const uses = useLiveQuery(() => (id ? listExercisesForCatalog(id) : []), [id], []);
  const templates = useLiveQuery(() => listTemplates(), [], []);

  const [editOpen, setEditOpen] = useState(false);
  const [editSeq, setEditSeq] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const names = templateNames(templates);

  const back = (
    <Link
      to="/programme"
      aria-label="Back to the library"
      className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted active:bg-surface-2"
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 5l-7 7 7 7"
        />
      </svg>
    </Link>
  );

  if (entry === undefined) {
    return (
      <div>
        <PageHeader title="Library" leading={back} />
        <p className="px-4 py-10 text-center text-sm text-muted">Loading…</p>
      </div>
    );
  }

  if (!entry) {
    return (
      <div>
        <PageHeader title="Not found" leading={back} />
        <p className="px-4 py-10 text-center text-sm text-muted">
          That library entry no longer exists.
        </p>
      </div>
    );
  }

  const addToDay = async (templateId: TemplateId) => {
    const added = await addExerciseFromCatalog(templateId, entry.id);
    setAddOpen(false);
    setToast(`Added to ${names.get(templateId) ?? templateId} — ${formatPrescription(added)}`);
  };

  const secondary = sortMuscles(entry.secondary);

  return (
    <div>
      <PageHeader
        title={entry.name}
        leading={back}
        subtitle={entry.archived ? 'Retired — hidden from the pickers' : undefined}
      />

      {toast ? (
        <div
          role="status"
          className="mx-4 mt-1 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent"
        >
          {toast}
        </div>
      ) : null}

      <div className="space-y-4 px-4 pt-3">
        {entry.tags?.length ? (
          <div className="flex flex-wrap gap-2">
            {entry.tags.map((tag) => (
              <Chip key={tag}>{SPLIT_TAG_LABELS[tag]}</Chip>
            ))}
          </div>
        ) : null}

        <Card flush className="px-4 py-1">
          <DetailRow label="Primary">{muscleList(entry.primary) || '—'}</DetailRow>
          <DetailRow label="Secondary">
            {secondary.length ? muscleList(secondary) : '—'}
          </DetailRow>
          <DetailRow label="Equipment">{EQUIPMENT_LABELS[entry.equipment]}</DetailRow>
          <DetailRow label="Pattern">{PATTERN_LABELS[entry.pattern]}</DetailRow>
          <DetailRow label="Unilateral">{entry.unilateral ? 'Yes — each side' : 'No'}</DetailRow>
          <DetailRow label="Default load">
            {optionLabel(UNIT_OPTIONS, entry.defaultUnit)}
          </DetailRow>
          <DetailRow label="Default measure">
            {optionLabel(MEASURE_OPTIONS, entry.defaultMeasure)}
          </DetailRow>
        </Card>

        {entry.notes ? (
          <Card>
            <h2 className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">
              Notes
            </h2>
            <p className="text-sm text-fg">{entry.notes}</p>
          </Card>
        ) : null}

        <section>
          <h2 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">
            Appears in
          </h2>
          {uses.length === 0 ? (
            <p className="text-sm text-muted">Not on any day yet.</p>
          ) : (
            <ul className="divide-y divide-border/50 overflow-hidden rounded-2xl border border-border/70 bg-surface">
              {uses.map((row) => (
                <li key={row.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">
                      {names.get(row.templateId) ?? row.templateId}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {row.name} · {formatPrescription(row)} ·{' '}
                      {unitLabel(row.unit, exerciseMassUnit(row))}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-3 pt-1">
          <Button full onClick={() => setAddOpen(true)} disabled={entry.archived}>
            Add to day…
          </Button>
          <div className="flex gap-3">
            <Button
              variant="secondary"
              size="md"
              full
              onClick={() => {
                setEditSeq((n) => n + 1);
                setEditOpen(true);
              }}
            >
              Edit
            </Button>
            {entry.archived ? (
              <Button
                variant="secondary"
                size="md"
                full
                onClick={() => void archiveCatalogEntry(entry.id, false)}
              >
                Restore
              </Button>
            ) : (
              <Button variant="danger" size="md" full onClick={() => setConfirmRetire(true)}>
                Retire
              </Button>
            )}
          </div>
        </div>
      </div>

      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title={`Add ${entry.name} to…`}>
        <p className="mb-3 text-xs text-muted">
          Lands at the bottom of the day with the library defaults — adjust the sets and reps
          from the Days editor.
        </p>
        <ul className="space-y-2">
          {templates.map((template) => (
            <li key={template.id}>
              <button
                type="button"
                onClick={() => void addToDay(template.id)}
                className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2 text-left active:bg-surface-2"
              >
                <span className="min-w-0 flex-1 truncate text-base text-fg">
                  {template.name}
                </span>
                <span className="shrink-0 text-xs text-accent">Add</span>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>

      <CatalogEntrySheet
        key={`${entry.id}:${editSeq}`}
        open={editOpen}
        entry={entry}
        onClose={() => setEditOpen(false)}
      />

      <ConfirmDialog
        open={confirmRetire}
        title={`Retire ${entry.name}?`}
        message="It disappears from the pickers. Programme rows and logged sets keep working, and you can restore it from “Show retired”."
        confirmLabel="Retire"
        onConfirm={() => {
          void archiveCatalogEntry(entry.id);
          setConfirmRetire(false);
        }}
        onCancel={() => setConfirmRetire(false)}
      />
    </div>
  );
}

export default CatalogEntryScreen;
