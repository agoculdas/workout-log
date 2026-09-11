import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { ensureSeeded } from './db/db';

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

// Seed the programme before first paint so Today has something to show.
ensureSeeded()
  .catch((error: unknown) => {
    console.error('Failed to seed the database', error);
  })
  .finally(() => {
    requestPersistentStorage();
    render();
  });
