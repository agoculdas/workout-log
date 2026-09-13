import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Card, ConfirmDialog, NumberField, PageHeader } from '../components';
import { exportAll, importMerge, markExported, updateSettings, wipeAll } from '../db/repo';
import { formatDate, formatNumber } from '../logic/format';
import useSettings from '../hooks/useSettings';
import type { MassUnit } from '../db/types';
import {
  backupFilename,
  bundleToText,
  copyText,
  downloadText,
  formatBytes,
  parseImportText,
  summariseImport,
} from './settings/backup';
import useInstallPrompt from './settings/useInstallPrompt';

const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '1.0.0';

interface Status {
  kind: 'ok' | 'error';
  text: string;
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="px-4 pt-6">
      <h2 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">{title}</h2>
      <Card className="space-y-4">{children}</Card>
      {note ? <p className="mt-2 text-xs text-muted">{note}</p> : null}
    </section>
  );
}

/** Switch row: label + description on the left, a sliding switch on the right. */
function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-12 w-full items-center gap-3 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-base">{label}</span>
        {description ? <span className="block text-xs text-muted">{description}</span> : null}
      </span>
      <span
        aria-hidden="true"
        className={[
          'flex h-7 w-12 shrink-0 items-center rounded-full border p-0.5 transition-colors',
          checked ? 'border-accent bg-accent' : 'border-border bg-surface-2',
        ].join(' ')}
      >
        <span
          className={[
            'h-5.5 w-5.5 rounded-full bg-fg transition-transform',
            checked ? 'translate-x-5' : '',
          ].join(' ')}
        />
      </span>
    </button>
  );
}

/** How long to wait after the last keystroke before writing to Dexie. */
const REST_COMMIT_DEBOUNCE_MS = 400;

type NotifyState = 'unsupported' | NotificationPermission;

function readNotifyState(): NotifyState {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

const NOTIFY_LABEL: Record<NotifyState, string> = {
  unsupported: 'Not supported in this browser',
  granted: 'Allowed',
  denied: 'Blocked — turn it back on in your browser settings',
  default: 'Not asked yet',
};

/** Seconds and set counts are whole numbers; bar weight and plates are not. */
const WHOLE = (n: number) => Math.max(0, Math.round(n));

/**
 * A settings number field. Typing is debounced so "135" is stored once rather
 * than as 1 → 13 → 135; the -/+ steppers and blur commit straight away.
 * Re-syncs when the stored value changes underneath it (first load, import,
 * wipe). `clean` is applied to whatever is committed, never to what is typed.
 */
function DebouncedField({
  label,
  value: stored,
  onCommit,
  hint,
  step,
  min = 0,
  max,
  suffix,
  clean = (n: number) => Math.max(0, n),
  className,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  hint?: string;
  step: number;
  min?: number;
  max?: number;
  suffix?: string;
  clean?: (value: number) => number;
  className?: string;
}) {
  const [draft, setDraft] = useState<number | null>(stored);
  const [synced, setSynced] = useState(stored);
  const pending = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (stored !== synced) {
    setSynced(stored);
    if (pending.current === null) setDraft(stored);
  }

  const cancel = () => {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
  };

  const flush = () => {
    cancel();
    const value = pending.current;
    pending.current = null;
    if (value !== null) onCommit(value);
  };

  // Never leave a pending write behind on unmount (tab switch mid-edit).
  useEffect(() => flush, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <NumberField
      label={label}
      value={draft}
      onChange={(value, source) => {
        setDraft(value);
        if (value === null || !Number.isFinite(value)) {
          cancel();
          pending.current = null;
          return;
        }
        const next = clean(value);
        if (source === 'step') {
          cancel();
          pending.current = null;
          onCommit(next);
          return;
        }
        pending.current = next;
        cancel();
        timer.current = setTimeout(flush, REST_COMMIT_DEBOUNCE_MS);
      }}
      onBlur={flush}
      step={step}
      min={min}
      {...(max === undefined ? {} : { max })}
      {...(suffix === undefined ? {} : { suffix })}
      {...(hint === undefined ? {} : { hint })}
      {...(className === undefined ? {} : { className })}
    />
  );
}

/**
 * Units, rest-timer defaults, JSON backup/restore, wipe, and install/storage
 * info. Everything writes through `repo` — no direct Dexie access here.
 */
export function Settings() {
  const settings = useSettings();
  const install = useInstallPrompt();
  const fileRef = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [notify, setNotify] = useState<NotifyState>(readNotifyState);
  const [newPlate, setNewPlate] = useState<number | null>(null);

  /**
   * Settings writes are read-modify-write, so two taps in quick succession can
   * race and clobber each other. Chain them instead.
   */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const commit = (patch: Parameters<typeof updateSettings>[0]) => {
    queue.current = queue.current.then(() => updateSettings(patch)).catch(() => undefined);
  };

  /** Heaviest first, deduplicated — the calculator works down the list. */
  const addPlate = () => {
    if (newPlate === null || !(newPlate > 0)) return;
    setNewPlate(null);
    if (settings.plates.some((p) => Math.abs(p - newPlate) < 1e-9)) return;
    commit({ plates: [...settings.plates, newPlate].sort((a, b) => b - a) });
  };

  const removePlate = (plate: number) => {
    commit({ plates: settings.plates.filter((p) => p !== plate) });
  };

  /** The band never crosses itself: raising the floor pushes the ceiling up. */
  const commitTargetMin = (min: number) => {
    commit({ setsPerMuscleTarget: { min, max: Math.max(min, settings.setsPerMuscleTarget.max) } });
  };

  const commitTargetMax = (max: number) => {
    commit({ setsPerMuscleTarget: { min: Math.min(max, settings.setsPerMuscleTarget.min), max } });
  };

  useEffect(() => {
    let cancelled = false;
    void navigator.storage?.estimate?.().then((estimate) => {
      if (cancelled) return;
      setStorage({ usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 });
    });
    void navigator.storage?.persisted?.().then((value) => {
      if (!cancelled) setPersisted(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** The app already asked once at launch; this is the user asking again. */
  const requestPersist = async () => {
    try {
      setPersisted((await navigator.storage?.persist?.()) ?? false);
    } catch {
      setPersisted(false);
    }
  };

  const askToNotify = async () => {
    if (typeof Notification === 'undefined') return;
    try {
      setNotify(await Notification.requestPermission());
    } catch {
      setNotify(readNotifyState());
    }
  };

  const exportJson = async () => {
    setBusy(true);
    try {
      const text = bundleToText(await exportAll());
      const name = backupFilename();
      if (downloadText(text, name)) {
        await markExported();
        setStatus({ kind: 'ok', text: `Saved ${name}. Check your downloads.` });
      } else {
        setStatus({
          kind: 'error',
          text: 'The browser blocked the download — use “Copy to clipboard” instead.',
        });
      }
    } catch {
      setStatus({ kind: 'error', text: 'Export failed. Try again.' });
    } finally {
      setBusy(false);
    }
  };

  const exportToClipboard = async () => {
    setBusy(true);
    try {
      const text = bundleToText(await exportAll());
      const copied = await copyText(text);
      if (copied) await markExported();
      setStatus(
        copied
          ? { kind: 'ok', text: 'Backup copied — paste it somewhere safe.' }
          : {
              kind: 'error',
              text: 'Clipboard blocked. Use “Export JSON” to save a file instead.',
            },
      );
    } catch {
      setStatus({ kind: 'error', text: 'Export failed. Try again.' });
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file: File) => {
    setBusy(true);
    try {
      const counts = await importMerge(parseImportText(await file.text()));
      setStatus({ kind: 'ok', text: summariseImport(counts) });
    } catch (error) {
      setStatus({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Import failed.',
      });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const wipe = async () => {
    setConfirmWipe(false);
    setBusy(true);
    try {
      await wipeAll();
      setStatus({ kind: 'ok', text: 'Data wiped, programme restored.' });
    } catch {
      setStatus({ kind: 'error', text: 'Wipe failed. Try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Settings" />

      {status ? (
        <div className="px-4 pt-2">
          <div
            role="status"
            className={[
              'flex items-start gap-3 rounded-xl border px-3 py-2 text-sm',
              status.kind === 'ok'
                ? 'border-accent/40 bg-accent/10 text-fg'
                : 'border-danger/50 bg-danger/10 text-fg',
            ].join(' ')}
          >
            <span className="flex-1">{status.text}</span>
            <button
              type="button"
              aria-label="Dismiss message"
              onClick={() => setStatus(null)}
              className="shrink-0 text-muted"
            >
              ✕
            </button>
          </div>
        </div>
      ) : null}

      <Section title="Units" note="Volume totals are always converted to kilograms.">
        <div>
          <label
            htmlFor="units"
            className="mb-1 block text-xs font-medium tracking-wide text-muted uppercase"
          >
            Default unit for new exercises
          </label>
          <select
            id="units"
            value={settings.units}
            onChange={(e) => commit({ units: e.target.value as MassUnit })}
            className="h-14 w-full appearance-none rounded-xl border border-border bg-surface px-3 text-base text-fg disabled:opacity-40"
          >
            <option value="kg">Kilograms (kg)</option>
            <option value="lb">Pounds (lb)</option>
          </select>
          <p className="mt-1 text-xs text-muted">
            Each exercise can be set to kg or lb in Programme.
          </p>
        </div>
      </Section>

      <Section
        title="Rest timer"
        note="Defaults for the countdown that starts when you tick a set off."
      >
        <DebouncedField
          label="Primary lifts"
          value={settings.restPrimary}
          onCommit={(restPrimary) => commit({ restPrimary })}
          step={15}
          max={600}
          suffix="s"
          clean={WHOLE}
          hint="Default 120 s. Warm-ups rest for half as long."
        />
        <DebouncedField
          label="Accessories"
          value={settings.restAccessory}
          onCommit={(restAccessory) => commit({ restAccessory })}
          step={15}
          max={600}
          suffix="s"
          clean={WHOLE}
          hint="Default 90 s."
        />
      </Section>

      <Section title="Plates" note="Used by the plate calculator on barbell exercises.">
        <DebouncedField
          label="Bar weight"
          value={settings.barWeight}
          onCommit={(barWeight) => commit({ barWeight })}
          step={2.5}
          max={100}
          suffix="kg"
        />

        <div className="border-t border-border/70 pt-4">
          <p className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">
            Plates per side
          </p>
          {settings.plates.length ? (
            <div className="flex flex-wrap gap-2">
              {settings.plates.map((plate) => (
                <button
                  key={plate}
                  type="button"
                  onClick={() => removePlate(plate)}
                  aria-label={`Remove ${formatNumber(plate)} kg plate`}
                  className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border bg-surface px-3 text-muted active:bg-surface-2"
                >
                  <span className="text-sm leading-none tabular-nums">{formatNumber(plate)}</span>
                  <span aria-hidden="true" className="text-sm leading-none">
                    ×
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No plates — the calculator has nothing to load.</p>
          )}

          <div className="mt-3 flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <NumberField
                label="Add plate"
                value={newPlate}
                onChange={(value) => setNewPlate(value)}
                step={1.25}
                min={0}
                max={100}
                suffix="kg"
              />
            </div>
            <Button
              variant="secondary"
              className="shrink-0"
              disabled={newPlate === null || newPlate <= 0}
              onClick={addPlate}
            >
              Add
            </Button>
          </div>
        </div>
      </Section>

      <Section
        title="Muscles report"
        note="Reference band on the Muscles chart. Roughly 10–20 hard sets per muscle per week is the usual range."
      >
        <DebouncedField
          label="Min sets per muscle"
          value={settings.setsPerMuscleTarget.min}
          onCommit={commitTargetMin}
          step={1}
          max={60}
          clean={WHOLE}
        />
        <DebouncedField
          label="Max sets per muscle"
          value={settings.setsPerMuscleTarget.max}
          onCommit={commitTargetMax}
          step={1}
          max={60}
          clean={WHOLE}
        />
      </Section>

      <Section
        title="During a session"
        note="Timers stop counting when the app is in the background — the notification is what reaches you there."
      >
        <Toggle
          label="Keep screen on during sessions"
          description="Holds a wake lock while the logging screen is open."
          checked={settings.keepAwake}
          onChange={(keepAwake) => commit({ keepAwake })}
        />

        <div className="border-t border-border/70 pt-4">
          <p className="text-base">Notify when rest ends</p>
          <p className="mt-0.5 text-xs text-muted">
            When the app is in the background. {NOTIFY_LABEL[notify]}.
          </p>
          {notify === 'default' ? (
            <Button
              full
              variant="secondary"
              className="mt-3"
              onClick={() => void askToNotify()}
            >
              Allow notifications
            </Button>
          ) : null}
        </div>
      </Section>

      <Section
        title="Backup"
        note="Import merges: rows you already have are kept, never overwritten."
      >
        <div className="space-y-3">
          <Button full disabled={busy} onClick={() => void exportJson()}>
            Export JSON
          </Button>
          <Button full variant="secondary" disabled={busy} onClick={() => void exportToClipboard()}>
            Copy to clipboard
          </Button>
          <p className="text-xs text-muted">
            Last backup:{' '}
            {settings.lastExportAt === undefined ? 'never' : formatDate(settings.lastExportAt)}.
            Some installed PWAs block file downloads — the clipboard copy is the fallback.
          </p>
        </div>

        <div className="space-y-2 border-t border-border/70 pt-4">
          <Button
            full
            variant="secondary"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            Import JSON…
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importFile(file);
            }}
          />
        </div>
      </Section>

      <Section title="Danger zone">
        <div>
          <Button full variant="danger" disabled={busy} onClick={() => setConfirmWipe(true)}>
            Wipe all data
          </Button>
          <p className="mt-2 text-xs text-muted">
            Deletes every session and set, then re-seeds the stock programme.
          </p>
        </div>
      </Section>

      <Section title="About">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Version</dt>
            <dd className="tabular-nums">{APP_VERSION}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Storage used</dt>
            <dd className="tabular-nums">
              {storage
                ? `${formatBytes(storage.usage)}${
                    storage.quota ? ` of ${formatBytes(storage.quota)}` : ''
                  }`
                : '—'}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Storage</dt>
            <dd className="text-right">
              {persisted === null
                ? '—'
                : persisted
                  ? 'persistent'
                  : 'best-effort (may be cleared when space is low)'}
            </dd>
          </div>
        </dl>

        {persisted === false ? (
          <Button full variant="secondary" onClick={() => void requestPersist()}>
            Request persistent storage
          </Button>
        ) : null}

        <div className="border-t border-border/70 pt-4">
          {install.standalone ? (
            <p className="text-sm text-muted">Running as an installed app. </p>
          ) : install.canInstall ? (
            <Button full variant="secondary" onClick={() => void install.install()}>
              Install app
            </Button>
          ) : install.isIOS ? (
            <p className="text-sm text-muted">
              To install: tap <span className="text-fg">Share</span> in Safari, then{' '}
              <span className="text-fg">Add to Home Screen</span>.
            </p>
          ) : (
            <p className="text-sm text-muted">
              To install: use your browser menu → “Install app” / “Add to Home screen”.
            </p>
          )}
        </div>

        <p className="text-xs text-muted">
          Your data lives in this browser only — no account, no server, no sync. Clearing site
          data or deleting the app removes it, so export a backup now and then.
        </p>
      </Section>

      <ConfirmDialog
        open={confirmWipe}
        title="Wipe all data?"
        message="This deletes every session and set. Export first."
        confirmLabel="Wipe everything"
        onConfirm={() => void wipe()}
        onCancel={() => setConfirmWipe(false)}
      />
    </div>
  );
}

export default Settings;
