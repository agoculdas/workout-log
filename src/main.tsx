import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { ensureSeeded } from './db/db';
import { getActiveProgramme } from './db/repo';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

const root = createRoot(container);

function render() {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

/**
 * Ask the browser to mark this origin's storage as persistent, so the log is
 * not evicted when the device runs low on space. Chrome grants it silently for
 * installed / engaged sites, Firefox prompts, Safari decides for itself — the
 * answer does not change anything we do, so it is ignored. Once per launch.
 */
function requestPersistentStorage(): void {
  try {
    void navigator.storage?.persist?.().catch(() => undefined);
  } catch {
    /* storage manager missing or blocked — best-effort storage it is */
  }
}

/**
 * Roadmap 5.3: if the user has opted in and picked a folder, write the weekly
 * export into it.
 *
 * Called after `render()`, and through a dynamic `import()` so none of it —
 * not the module's own top level, not the database read, not the export —
 * runs before the first paint. A browser without the File System Access API
 * (every iOS one) answers `unsupported` and stops there; every failure path
 * inside resolves rather than throwing, and the two guards here catch the rest,
 * so a backup attempt can never reach the user.
 */
function startAutoBackup(): void {
  try {
    void import('./screens/settings/autoBackup')
      .then((module) => module.runAutoBackup())
      .catch(() => undefined);
  } catch {
    /* never let a backup attempt reach the user */
  }
}

// Seed the programme before first paint so Today has something to show, then
// repair the active flag if an import or a half-finished delete lost it. The
// screens only ever *read* which programme is active, so this is the one place
// the repairing write can happen without retriggering a live query.
ensureSeeded()
  .then(() => getActiveProgramme())
  .catch((error: unknown) => {
    console.error('Failed to prepare the database', error);
  })
  .finally(() => {
    requestPersistentStorage();
    render();
    startAutoBackup();
  });
