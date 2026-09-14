/**
 * Automatic backup (roadmap 5.3) for Android Chrome.
 *
 * The File System Access API hands back a `FileSystemDirectoryHandle` that can
 * only be kept by putting it in IndexedDB — it survives structured clone, not
 * JSON — so this module carries a tiny key-value store of its own rather than
 * touching the Dexie schema. One database, one object store, three keys:
 *
 *   dir      the directory handle the user picked
 *   enabled  whether the user has opted in (they must, once, by gesture)
 *   lastAt   when the last file was written
 *
 * Nothing here nags, and nothing runs before `chooseBackupFolder` succeeds:
 * on a browser without the API every entry point answers `unsupported` and the
 * Settings screen says so in one muted line.
 */
import { backupFilename, bundleToText } from './backup';

/* --------------------------------------------------------------- constants */

const DB_NAME = 'workout-log-autobackup';
const STORE = 'kv';

const DIR_KEY = 'dir';
const ENABLED_KEY = 'enabled';
const LAST_KEY = 'lastAt';

/** How many `workout-log-*.json` files to leave in the folder. */
export const BACKUPS_KEPT = 8;

/** A week between automatic writes — the manual export is always there. */
export const BACKUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------- types */

/**
 * Structural stand-ins for the File System Access API. `lib.dom` in this
 * project has neither `showDirectoryPicker` nor the permission methods, and
 * `values()` needs `DOM.AsyncIterable`, so the shapes we actually use are
 * declared here. A fake object with these members is enough to test against.
 */
export interface BackupWritable {
  write: (data: string) => Promise<void>;
  close: () => Promise<void>;
}

export interface BackupFileHandle {
  createWritable: () => Promise<BackupWritable>;
}

export interface BackupDirectoryEntry {
  kind: string;
  name: string;
}

export interface BackupDirectoryHandle {
  name: string;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<BackupFileHandle>;
  removeEntry: (name: string, options?: { recursive?: boolean }) => Promise<void>;
  values: () => AsyncIterable<BackupDirectoryEntry>;
  queryPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
}

type DirectoryPicker = (options?: {
  mode?: 'read' | 'readwrite';
  id?: string;
}) => Promise<BackupDirectoryHandle>;

/** 'none' means there is no stored folder to ask about. */
export type AutoBackupPermission = 'granted' | 'prompt' | 'denied' | 'none';

export interface AutoBackupState {
  supported: boolean;
  enabled: boolean;
  folderName?: string;
  lastAt?: number;
  permission: AutoBackupPermission;
}

export type AutoBackupResult =
  | 'written'
  | 'skipped'
  | 'no-permission'
  | 'unsupported'
  | 'disabled'
  | 'error';

/* -------------------------------------------------------- key-value store */

function openKv(): Promise<IDBDatabase | undefined> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(undefined);
        return;
      }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
      request.onblocked = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

/** Read one key. `undefined` for "missing" and for "the store would not open". */
export async function kvGet<T>(key: string): Promise<T | undefined> {
  const database = await openKv();
  if (!database) return undefined;
  try {
    return await new Promise<T | undefined>((resolve) => {
      const request = database.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  } finally {
    database.close();
  }
}

/**
 * Write one key. Returns whether it stuck — a directory handle that failed to
 * persist must not leave the feature switched on, because nothing would ever
 * be written and the UI would claim otherwise.
 */
export async function kvSet(key: string, value: unknown): Promise<boolean> {
  const database = await openKv();
  if (!database) return false;
  try {
    return await new Promise<boolean>((resolve) => {
      const tx = database.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  } catch {
    return false;
  } finally {
    database.close();
  }
}

export async function kvDelete(key: string): Promise<boolean> {
  const database = await openKv();
  if (!database) return false;
  try {
    return await new Promise<boolean>((resolve) => {
      const tx = database.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  } catch {
    return false;
  } finally {
    database.close();
  }
}

/* --------------------------------------------------------- pure decisions */

/**
 * Is a backup due? Never written and a bad stored value both count as due;
 * a `lastAt` in the future does not, so a clock jump cannot start a loop.
 */
export function shouldRun(lastAt: number | undefined, now: number, force = false): boolean {
  if (force) return true;
  if (lastAt === undefined || !Number.isFinite(lastAt)) return true;
  return now - lastAt >= BACKUP_INTERVAL_MS;
}

/** Our own files only — the folder may well be the user's Downloads. */
const BACKUP_FILE = /^workout-log-.+\.json$/;

/**
 * Which files to delete so that only the `keep` newest remain. The name
 * carries an ISO date, so a plain sort is chronological; anything that is not
 * one of our exports is left alone.
 */
export function filesToPrune(names: string[], keep: number = BACKUPS_KEPT): string[] {
  const limit = Math.max(0, Math.floor(keep));
  const ours = names.filter((name) => BACKUP_FILE.test(name)).sort();
  if (ours.length <= limit) return [];
  return ours.slice(0, ours.length - limit);
}

/* ------------------------------------------------------------ file writing */

/**
 * Write `text` into the folder as `name`, then trim the folder back to the
 * newest `keep` exports. A failed delete is not a failed backup: the file is
 * already on disk, so pruning problems are swallowed.
 */
export async function writeBackup(
  dir: BackupDirectoryHandle,
  text: string,
  name: string = backupFilename(),
  keep: number = BACKUPS_KEPT,
): Promise<void> {
  const file = await dir.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(text);
  } finally {
    await writable.close();
  }

  const names: string[] = [];
  try {
    for await (const entry of dir.values()) {
      if (entry.kind === 'file') names.push(entry.name);
    }
  } catch {
    return;
  }
  for (const stale of filesToPrune(names, keep)) {
    if (stale === name) continue;
    try {
      await dir.removeEntry(stale);
    } catch {
      /* the folder may be read-only for that entry — leave it */
    }
  }
}

/* ----------------------------------------------------------------- the API */

function pickerWindow(): (Window & { showDirectoryPicker?: DirectoryPicker }) | undefined {
  return typeof window === 'undefined' ? undefined : window;
}

/**
 * Chromium on Android and desktop only. In dev, `?nofs=1` forces the
 * unsupported branch so the iOS/Firefox copy can be looked at in a browser
 * that does have the API.
 */
export function isAutoBackupSupported(): boolean {
  const w = pickerWindow();
  if (!w) return false;
  if (import.meta.env.DEV && w.location?.search?.includes('nofs=1')) return false;
  return 'showDirectoryPicker' in w;
}

async function permissionOf(dir: BackupDirectoryHandle): Promise<AutoBackupPermission> {
  try {
    if (typeof dir.queryPermission !== 'function') return 'granted';
    const state = await dir.queryPermission({ mode: 'readwrite' });
    return state === 'granted' || state === 'denied' ? state : 'prompt';
  } catch {
    return 'prompt';
  }
}

/** Only ever called from a click — Chrome refuses the prompt otherwise. */
async function askPermission(dir: BackupDirectoryHandle): Promise<AutoBackupPermission> {
  const current = await permissionOf(dir);
  if (current === 'granted') return 'granted';
  try {
    if (typeof dir.requestPermission !== 'function') return current;
    const state = await dir.requestPermission({ mode: 'readwrite' });
    return state === 'granted' || state === 'denied' ? state : 'prompt';
  } catch {
    return 'denied';
  }
}

/**
 * Show the folder picker and opt in. Must be called from a user gesture.
 * Returns false when the user cancelled or the handle could not be stored.
 */
export async function chooseBackupFolder(): Promise<boolean> {
  const w = pickerWindow();
  if (!w?.showDirectoryPicker || !isAutoBackupSupported()) return false;
  try {
    const dir = await w.showDirectoryPicker({ mode: 'readwrite', id: 'workout-log-backups' });
    if (!dir) return false;
    if (!(await kvSet(DIR_KEY, dir))) return false;
    await kvDelete(LAST_KEY);
    return await kvSet(ENABLED_KEY, true);
  } catch {
    // AbortError when the user backs out of the picker; anything else is a no.
    return false;
  }
}

/** Forget the folder and switch off. Files already written are left alone. */
export async function disableAutoBackup(): Promise<void> {
  await kvSet(ENABLED_KEY, false);
  await kvDelete(DIR_KEY);
  await kvDelete(LAST_KEY);
}

/** Everything the Settings block needs to describe itself. */
export async function getAutoBackupState(): Promise<AutoBackupState> {
  const supported = isAutoBackupSupported();
  if (!supported) return { supported: false, enabled: false, permission: 'none' };
  const dir = await kvGet<BackupDirectoryHandle>(DIR_KEY);
  const enabled = (await kvGet<boolean>(ENABLED_KEY)) === true && dir !== undefined;
  return {
    supported,
    enabled,
    folderName: dir?.name,
    lastAt: await kvGet<number>(LAST_KEY),
    permission: dir ? await permissionOf(dir) : 'none',
  };
}

/**
 * Write the export into the chosen folder if one is due.
 *
 * Called once at launch with no arguments (silent, and only when a week has
 * passed and permission is already granted) and from the "Back up now" button
 * with `force`, which is the only path allowed to raise a permission prompt.
 */
export async function runAutoBackup(opts: { force?: boolean } = {}): Promise<AutoBackupResult> {
  const force = opts.force === true;
  try {
    if (!isAutoBackupSupported()) return 'unsupported';

    const dir = await kvGet<BackupDirectoryHandle>(DIR_KEY);
    const enabled = (await kvGet<boolean>(ENABLED_KEY)) === true;
    if (!enabled || !dir) return 'disabled';

    if (!shouldRun(await kvGet<number>(LAST_KEY), Date.now(), force)) return 'skipped';

    const permission = force ? await askPermission(dir) : await permissionOf(dir);
    if (permission !== 'granted') return 'no-permission';

    // Loaded lazily so this module stays importable without a database.
    const { exportAll, markExported } = await import('../../db/repo');
    await writeBackup(dir, bundleToText(await exportAll()));
    await kvSet(LAST_KEY, Date.now());
    await markExported();
    return 'written';
  } catch {
    return 'error';
  }
}
