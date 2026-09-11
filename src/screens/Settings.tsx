import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Card, ConfirmDialog, NumberField, PageHeader } from '../components';
import { exportAll, importMerge, updateSettings, wipeAll } from '../db/repo';
import useSettings from '../hooks/useSettings';
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

/** How long to wait after the last keystroke before writing to Dexie. */
const REST_COMMIT_DEBOUNCE_MS = 400;

/**
 * Rest-timer field. Typing is debounced so "135" is stored once rather than as
 * 1 → 13 → 135; the -/+ steppers and blur commit straight away. Re-syncs when
 * the stored value changes underneath it (first load, import, wipe).
 */
function RestField({
  label,
  seconds,
  onCommit,
  hint,
}: {
  label: string;
  seconds: number;
  onCommit: (value: number) => void;
  hint: string;
}) {
  const [draft, setDraft] = useState<number | null>(seconds);
  const [synced, setSynced] = useState(seconds);
  const pending = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (seconds !== synced) {
    setSynced(seconds);
    if (pending.current === null) setDraft(seconds);
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
        const clean = Math.max(0, Math.round(value));
        if (source === 'step') {
          cancel();
          pending.current = null;
          onCommit(clean);
          return;
        }
        pending.current = clean;
        cancel();
        timer.current = setTimeout(flush, REST_COMMIT_DEBOUNCE_MS);
      }}
      onBlur={flush}
      step={15}
      min={0}
      max={600}
      suffix="s"
      hint={hint}
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

  /**
   * Settings writes are read-modify-write, so two taps in quick succession can
   * race and clobber each other. Chain them instead.
   */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const commit = (patch: Parameters<typeof updateSettings>[0]) => {
    queue.current = queue.current.then(() => updateSettings(patch)).catch(() => undefined);
  };

  useEffect(() => {
    let cancelled = false;
    void navigator.storage?.estimate?.().then((estimate) => {
      if (cancelled) return;
      setStorage({ usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const exportJson = async () => {
    setBusy(true);
    try {
      const text = bundleToText(await exportAll());
      const name = backupFilename();
      if (downloadText(text, name)) {
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
      setStatus(
        (await copyText(text))
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

      <Section title="Units" note="Everything is stored in kilograms for now.">
        <div>
          <label
            htmlFor="units"
            className="mb-1 block text-xs font-medium tracking-wide text-muted uppercase"
          >
            Weight unit
          </label>
          <select
            id="units"
            value={settings.units}
            disabled
            onChange={(e) => commit({ units: e.target.value as 'kg' })}
            className="h-14 w-full appearance-none rounded-xl border border-border bg-surface px-3 text-base text-fg disabled:opacity-40"
          >
            <option value="kg">Kilograms (kg)</option>
          </select>
          <p className="mt-1 text-xs text-muted">More soon.</p>
        </div>
      </Section>

      <Section
        title="Rest timer"
        note="Defaults for the countdown that starts when you tick a set off."
      >
        <RestField
          label="Primary lifts"
          seconds={settings.restPrimary}
          onCommit={(restPrimary) => commit({ restPrimary })}
          hint="Default 120 s."
        />
        <RestField
          label="Accessories"
          seconds={settings.restAccessory}
          onCommit={(restAccessory) => commit({ restAccessory })}
          hint="Default 90 s."
        />
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
        </dl>

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
