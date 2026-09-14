import { describe, expect, it } from 'vitest';
import {
  BACKUPS_KEPT,
  BACKUP_INTERVAL_MS,
  filesToPrune,
  shouldRun,
  writeBackup,
  type BackupDirectoryEntry,
  type BackupDirectoryHandle,
} from './autoBackup';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 14, 9, 0);

describe('shouldRun', () => {
  it('runs when there is no record of a backup', () => {
    expect(shouldRun(undefined, NOW)).toBe(true);
  });

  it('treats a nonsense stored value as never backed up', () => {
    expect(shouldRun(Number.NaN, NOW)).toBe(true);
  });

  it('waits while the last backup is under a week old', () => {
    expect(shouldRun(NOW - 6 * DAY, NOW)).toBe(false);
    expect(shouldRun(NOW - BACKUP_INTERVAL_MS + 1, NOW)).toBe(false);
  });

  it('runs once a week has passed', () => {
    expect(shouldRun(NOW - BACKUP_INTERVAL_MS, NOW)).toBe(true);
    expect(shouldRun(NOW - 8 * DAY, NOW)).toBe(true);
  });

  it('force overrides the interval', () => {
    expect(shouldRun(NOW - 60_000, NOW, true)).toBe(true);
  });

  it('does not run again when the clock jumped backwards', () => {
    expect(shouldRun(NOW + 5 * DAY, NOW)).toBe(false);
  });
});

describe('filesToPrune', () => {
  const backups = (n: number) =>
    Array.from({ length: n }, (_, i) => `workout-log-2026-09-${String(i + 1).padStart(2, '0')}.json`);

  it('keeps everything while the folder is under the limit', () => {
    expect(filesToPrune(backups(BACKUPS_KEPT))).toEqual([]);
    expect(filesToPrune(backups(3))).toEqual([]);
  });

  it('drops the oldest by name, keeping the 8 newest', () => {
    const pruned = filesToPrune(backups(11));
    expect(pruned).toEqual([
      'workout-log-2026-09-01.json',
      'workout-log-2026-09-02.json',
      'workout-log-2026-09-03.json',
    ]);
  });

  it('sorts by name regardless of listing order', () => {
    const shuffled = [...backups(10)].reverse();
    expect(filesToPrune(shuffled)).toEqual([
      'workout-log-2026-09-01.json',
      'workout-log-2026-09-02.json',
    ]);
  });

  it('ignores files that are not our exports', () => {
    const names = ['notes.txt', 'workout-log.json', 'strong-export.csv', ...backups(9)];
    expect(filesToPrune(names)).toEqual(['workout-log-2026-09-01.json']);
  });

  it('honours a custom keep count', () => {
    expect(filesToPrune(backups(4), 2)).toHaveLength(2);
    expect(filesToPrune(backups(4), 0)).toHaveLength(4);
  });
});

/** A directory handle with just the members `writeBackup` touches. */
function fakeDir(existing: string[] = []) {
  const files = new Set(existing);
  const written: { name: string; text: string; closed: boolean }[] = [];
  const removed: string[] = [];

  const dir: BackupDirectoryHandle = {
    name: 'Backups',
    getFileHandle: async (name, options) => {
      if (!files.has(name) && !options?.create) throw new Error('not found');
      files.add(name);
      const record = { name, text: '', closed: false };
      written.push(record);
      return {
        createWritable: async () => ({
          write: async (data: string) => {
            record.text += data;
          },
          close: async () => {
            record.closed = true;
          },
        }),
      };
    },
    removeEntry: async (name) => {
      files.delete(name);
      removed.push(name);
    },
    values: () => ({
      async *[Symbol.asyncIterator](): AsyncGenerator<BackupDirectoryEntry> {
        for (const name of [...files]) yield { kind: 'file', name };
        yield { kind: 'directory', name: 'subfolder' };
      },
    }),
  };

  return { dir, written, removed, files };
}

describe('writeBackup', () => {
  it('creates the file, writes the text and closes the stream', async () => {
    const { dir, written, removed } = fakeDir();
    await writeBackup(dir, '{"version":1}', 'workout-log-2026-09-14.json');
    expect(written).toEqual([
      { name: 'workout-log-2026-09-14.json', text: '{"version":1}', closed: true },
    ]);
    expect(removed).toEqual([]);
  });

  it('prunes the folder back to the newest backups', async () => {
    const existing = Array.from(
      { length: 9 },
      (_, i) => `workout-log-2026-08-${String(i + 1).padStart(2, '0')}.json`,
    );
    const { dir, removed, files } = fakeDir([...existing, 'receipts.pdf']);
    await writeBackup(dir, '{}', 'workout-log-2026-09-14.json');
    expect(removed).toEqual([
      'workout-log-2026-08-01.json',
      'workout-log-2026-08-02.json',
    ]);
    expect(files.has('receipts.pdf')).toBe(true);
    expect(files.has('workout-log-2026-09-14.json')).toBe(true);
    expect([...files].filter((n) => n.startsWith('workout-log-'))).toHaveLength(BACKUPS_KEPT);
  });

  it('never deletes the file it just wrote', async () => {
    const { dir, removed } = fakeDir();
    await writeBackup(dir, '{}', 'workout-log-2026-09-14.json', 0);
    expect(removed).toEqual([]);
  });
});
