/**
 * Backup helpers for the Settings screen: file naming, JSON text, a guarded
 * parse with human-readable errors, and the download/clipboard plumbing.
 * Everything DOM-touching is confined to `downloadText`.
 */
import type { ExportBundle, ImportCounts } from '../../db/types';

/** `workout-log-2026-09-11.json` — local date, sorts chronologically. */
export function backupFilename(date: Date = new Date()): string {
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `workout-log-${y}-${m}-${d}.json`;
}

/** Pretty-printed so the file is readable (and diffable) in a text editor. */
export function bundleToText(bundle: ExportBundle): string {
  return JSON.stringify(bundle, null, 2);
}

/**
 * Parse pasted or uploaded backup text. Throws `Error` with a message meant
 * for the user — never a raw `SyntaxError`.
 */
export function parseImportText(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('That file is empty. Pick a backup exported from this app.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(
      "That file isn't valid JSON. Pick a backup exported from this app (workout-log-YYYY-MM-DD.json).",
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      "That JSON isn't a workout backup — expected an object with exercises, sessions and setLogs.",
    );
  }
  return parsed as Record<string, unknown>;
}

/** "Imported 3 sessions, 24 sets, skipped 0." */
export function summariseImport(counts: ImportCounts): string {
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  };
  add(counts.sessions, 'session', 'sessions');
  add(counts.setLogs, 'set', 'sets');
  add(counts.exercises, 'exercise', 'exercises');
  add(counts.templates, 'day', 'days');
  add(counts.bodyweight, 'weigh-in', 'weigh-ins');
  add(counts.settings, 'settings row', 'settings rows');
  const head = parts.length ? `Imported ${parts.join(', ')}` : 'Nothing new to import';
  return `${head}, skipped ${counts.skipped}.`;
}

/**
 * Save `text` as a file. Returns false when the browser blocked it (some
 * installed PWAs do) so the caller can fall back to the clipboard.
 */
export function downloadText(text: string, filename: string): boolean {
  try {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Give the download a tick to start before the blob goes away.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}

/** Clipboard fallback for environments where downloads are blocked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** "1.2 MB of 12 GB used" material for the About section. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}
