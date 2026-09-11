import { useLiveQuery } from 'dexie-react-hooks';
import { DEFAULT_SETTINGS } from '../db/seed';
import { readSettings, updateSettings } from '../db/repo';
import type { Settings } from '../db/types';

/**
 * Live settings row. Returns `DEFAULT_SETTINGS` until the first read resolves,
 * so callers never have to handle `undefined`.
 */
export function useSettings(): Settings {
  const settings = useLiveQuery(() => readSettings(), [], undefined);
  return settings ?? DEFAULT_SETTINGS;
}

/** `const [settings, setSettings] = useSettingsState()` convenience. */
export function useSettingsState(): [
  Settings,
  (patch: Partial<Omit<Settings, 'id'>>) => Promise<Settings>,
] {
  return [useSettings(), updateSettings];
}

export default useSettings;
