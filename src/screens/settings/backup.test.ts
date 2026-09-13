import { describe, expect, it } from 'vitest';
import {
  backupFilename,
  bundleToText,
  formatBytes,
  parseImportText,
  summariseImport,
} from './backup';
import type { ExportBundle, ImportCounts } from '../../db/types';

const emptyCounts: ImportCounts = {
  templates: 0,
  programmes: 0,
  exercises: 0,
  sessions: 0,
  setLogs: 0,
  settings: 0,
  bodyweight: 0,
  catalog: 0,
  skipped: 0,
};

describe('backupFilename', () => {
  it('is workout-log-YYYY-MM-DD.json in local time', () => {
    expect(backupFilename(new Date(2026, 8, 11, 13, 5))).toBe('workout-log-2026-09-11.json');
  });

  it('zero-pads month and day', () => {
    expect(backupFilename(new Date(2025, 0, 3))).toBe('workout-log-2025-01-03.json');
  });
});

describe('parseImportText', () => {
  it('returns the parsed object', () => {
    const bundle: ExportBundle = {
      version: 1,
      exportedAt: 1,
      templates: [],
      exercises: [],
      sessions: [],
      setLogs: [],
      settings: [],
      bodyweight: [],
    };
    const parsed = parseImportText(bundleToText(bundle));
    expect(parsed.version).toBe(1);
    expect(Array.isArray(parsed.sessions)).toBe(true);
  });

  it('rejects empty text with a friendly message', () => {
    expect(() => parseImportText('   ')).toThrow(/empty/i);
  });

  it('rejects malformed JSON without leaking a SyntaxError', () => {
    let caught: unknown;
    try {
      parseImportText('{ nope');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(SyntaxError);
    expect((caught as Error).message).toMatch(/valid JSON/i);
  });

  it('rejects JSON that is not an object', () => {
    expect(() => parseImportText('[1,2,3]')).toThrow(/workout backup/i);
    expect(() => parseImportText('"hello"')).toThrow(/workout backup/i);
  });
});

describe('summariseImport', () => {
  it('lists what landed', () => {
    expect(summariseImport({ ...emptyCounts, sessions: 3, setLogs: 24 })).toBe(
      'Imported 3 sessions, 24 sets, skipped 0.',
    );
  });

  it('singularises', () => {
    expect(summariseImport({ ...emptyCounts, sessions: 1, setLogs: 1, skipped: 2 })).toBe(
      'Imported 1 session, 1 set, skipped 2.',
    );
  });

  it('says so when a re-import adds nothing', () => {
    expect(summariseImport({ ...emptyCounts, skipped: 0 })).toBe(
      'Nothing new to import, skipped 0.',
    );
  });
});

describe('formatBytes', () => {
  it('scales units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(2048)).toBe('2 kB');
    expect(formatBytes(1_500_000)).toBe('1.4 MB');
  });

  it('guards nonsense', () => {
    expect(formatBytes(Number.NaN)).toBe('—');
  });
});
