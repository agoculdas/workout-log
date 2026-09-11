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

// Seed the programme before first paint so Today has something to show.
ensureSeeded()
  .catch((error: unknown) => {
    console.error('Failed to seed the database', error);
  })
  .finally(render);
