# Workout Log

A single-user, offline-first PWA for a fixed 4-day upper/lower programme — log sets in the gym
with no signal, and let it tell you when to add weight. No accounts, no backend, no sync.

Full requirements: [`workout-tracker-spec.md`](./workout-tracker-spec.md).

## The programme

Rotation: **Lower A → Upper A → Lower B → Upper B**, days not pinned to weekdays. The app picks
what's next and never suggests a lower day straight after another lower day.

Progression: when **every** set of an exercise hit the top of its rep range last session, the next
suggested load goes up by that exercise's increment (+5 kg on machines and the bar, +2.5 kg per
hand on dumbbells; bands and bodyweight items just track reps). Otherwise it suggests the same
load. Suggestions are pre-filled, never forced, and two regressing sessions in a row show a
"stalled" marker — no automatic deloads. Edit any exercise (sets, targets, unit, increment, type,
order) on the **Programme** tab; changes apply to future sessions only and never rewrite history.

## The exercise library

The **Programme** tab has two halves. *Days* is the day editor; *Library* is the catalogue of
movements behind it — what each one trains (primary and secondary muscles), how it is loaded
(equipment, pattern, unilateral, default unit and measure) and which days it already appears on.
Filter it by split tag, by muscle or by name, and tap an entry for its detail screen, where you
can add it to a day, edit it, or retire it (retired entries drop out of the pickers but old
programme rows and logged sets keep resolving). Adding or swapping an exercise on a day now picks
from the library, so the new row inherits the movement's defaults — a custom, unlinked exercise is
still one link away at the bottom of the picker. Renaming a library entry offers to rename the
programme rows that point at it.

## Stack

Vite + React 19 + TypeScript + Tailwind v4, Dexie (IndexedDB) for storage, `vite-plugin-pwa` for
the manifest and service worker, Vitest for the logic tests. Routing is a `HashRouter`, so URLs
look like `#/`, `#/history`, `#/programme`, `#/settings` and work from any static subpath.

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc --noEmit && vite build -> dist/
npm test         # Vitest, single run
```

Also available: `npm run preview`, `npm run test:watch`, `npm run typecheck`, `npm run lint`,
`npm run gen:icons` (regenerates the placeholder PWA icons in `public/`).

## Install it on your phone

The service worker only runs in a real build, so `npm run build && npm run preview` (or the
deployed URL) — not the dev server.

- **Android / Chrome**: open the site, then menu **⋮ → Install app** (or the install prompt in the
  address bar). Settings → About also has an **Install app** button once Chrome offers one.
- **iOS / Safari**: open the site, tap **Share** → **Add to Home Screen**. Safari has no install
  prompt, so this is the only route; use Safari, not Chrome for iOS.

Once installed it launches full-screen, portrait, and works with the phone in aeroplane mode.

## Gym-friendly extras

- **The screen stays on** while a session is open (Settings → During a session turns it off).
- **Rest-timer notification.** Phone timers freeze when the app is in the background, so the
  end of a rest also fires a "Rest over" notification — allow it from Settings, or on your first
  logged set. Coming back to the app replays the beep if you missed it. On iOS notifications only
  work once the app is installed to the home screen (iOS 16.4+).
- **Persistent storage** is requested at launch, so the browser will not evict the log when space
  runs low. Settings → About shows whether it was granted.
- **Past sessions are editable.** History → expand a session → expand an exercise to correct or
  delete any set, and edit the session note. Each session also stores its exercises as they were
  prescribed that day, so renaming or reordering on the Programme tab never rewrites history.
- **Muscle report.** History → Muscles shows weekly sets per muscle over the last week, 4 weeks or
  8 weeks — a set counts 1 for each primary muscle of its library entry and 0.5 for each secondary
  one, averaged over the weeks that actually trained. Under it sit the week-by-week total and the
  push:pull and squat:hinge ratios. Sets whose exercise has no library link are called out and
  counted nowhere.

## Backup and restore

Everything lives in this browser's IndexedDB — clearing site data or deleting the app deletes the
log, so back it up from **Settings → Backup**:

- **Export JSON** saves `workout-log-YYYY-MM-DD.json`. **Copy to clipboard** is the fallback for
  installed PWAs that block downloads — paste it into a note or a file.
- **Import JSON** *merges*: rows whose id already exists are kept, never overwritten, so
  re-importing the same file is a no-op and importing a phone backup onto a laptop just adds what
  is missing. The result is reported as e.g. "Imported 3 sessions, 24 sets, skipped 0."
- **Wipe all data** (Danger zone) clears everything and re-seeds the stock programme.

## Deploy

**GitHub Pages is already wired up** by [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml):
every push to `main` runs the tests, builds, and deploys `dist/`. One-time setup: repository
**Settings → Pages → Source: "GitHub Actions"**. The site then lives at
`https://<user>.github.io/<repo>/` — `base: './'` and the `HashRouter` mean the subpath needs no
extra configuration.

Alternatives: `npx vercel --prod`, or drag `dist/` onto Netlify. Any static host works.

## Layout

- `src/db/` — Dexie schema (`db.ts`), types, seed programme and every data-access function the
  screens use (`repo.ts`). Screens never touch Dexie directly.
- `src/logic/` — pure, tested rules: progression, stall detection, next-session rotation, volume
  maths, formatting.
- `src/screens/` — one file per screen, with a folder of helpers next to the bigger ones.
- `src/components/` — shared primitives (Button, NumberField, Card, PageHeader, Sheet/ConfirmDialog).

Icons in `public/` are generated placeholders; replace them with real artwork when there is any.
