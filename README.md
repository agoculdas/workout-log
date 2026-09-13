# Workout Log

A single-user, offline-first PWA for whatever split you run — log sets in the gym with no
signal, and let it tell you when to add weight. No accounts, no backend, no sync.

Full requirements: [`workout-tracker-spec.md`](./workout-tracker-spec.md).

## Programmes

A **programme** is a list of *days* plus a *rotation*. A day has a name and split tags (`upper`,
`lower`, `push`, `pull`, `legs`, body parts, `cardio`); the rotation is an ordered strip of those
days and **rest** slots, e.g. `L · U · rest · L · U · rest · rest`. Nothing is pinned to a weekday:
Today walks the rotation from the slot the last session *of that programme* came from — a spell on
another split and back picks up where you left it — and **each rest slot elapses with one calendar
day**, so two rest slots read "Rest day 1 of 2", then "2 of 2", then the next training day. A rest
day is only ever a suggestion: **Train anyway** on Today is one tap.

The **same kind of day** rule: if the day that comes up shares its tag set with a session you
finished in the last 24 hours, Today skips to the first day that does not and says why. Push and
Pull never clash (different tags); Lower A and Lower B do. Tags also name the day: one tagged
`lower` reads "Lower", one tagged `lower` + `legs` reads "Legs". *Choose a different session*
overrides it, and notes which days are the same kind as what you just trained.

Several programmes can be saved — exactly one is **active**, and it drives Today, the pickers and
the library's "appears in" hints. Build one on **Programme → Programmes**, duplicate an existing
one, or start from a preset: Upper/Lower 4-day, PPL 6-day, PPL 3-day, Full body 3-day, Body-part
5-day. Renaming, reordering or retiring a day never rewrites history — a session stores the day's
name and its exercises as they were prescribed that morning.

Progression: when **every** set of an exercise hit the top of its rep range last session, the next
suggested load goes up by that exercise's increment (+5 kg on machines and the bar, +2.5 kg per
hand on dumbbells; bands and bodyweight items just track reps). Each exercise is denominated in kg
or **lb** on its own — some machines are marked in pounds — and volume totals always convert to
kilograms. Suggestions are pre-filled, never forced, and two regressing sessions in a row show a
"stalled" marker — tap it for a deload or a drop to the bottom of the range, never automatic.
Every exercise is editable on the **Programme** tab, including the scheme its load advances on.

## The exercise library

*Library*, beside *Days* on the **Programme** tab, is the catalogue behind every exercise: what
each movement trains (primary and secondary muscles) and how it is loaded (equipment, pattern,
unilateral, default unit and measure). Filter by split tag, muscle or name; tap an entry to add it
to a day, edit it or retire it (retired entries leave the pickers, old rows and sets keep
resolving). Adding or swapping on a day picks from here, so the row inherits the movement's
defaults — a custom, unlinked exercise is one link away at the bottom of the picker.

## Stack

Vite + React 19 + TypeScript + Tailwind v4, Dexie (IndexedDB) for storage, Recharts for the history
charts, `vite-plugin-pwa` for the manifest and service worker, Vitest for the logic tests. Routing
is a `HashRouter`, so URLs look like `#/`, `#/history`, `#/programme` and work from any subpath.

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc --noEmit && vite build -> dist/
npm test         # Vitest, single run
```

Also: `npm run preview`, `test:watch`, `typecheck`, `lint`, `gen:icons`.

## Install it on your phone

The service worker only runs in a real build, so `npm run build && npm run preview` (or the
deployed URL) — not the dev server. On **Android / Chrome**: menu **⋮ → Install app** (Settings →
About has a button too, once Chrome offers one). On **iOS**: Safari's **Share → Add to Home
Screen**, the only route there. Once installed it launches full-screen, portrait, and works in
aeroplane mode.

## Gym-friendly extras

- **The screen stays on** while a session is open (Settings → During a session turns it off).
- **Rest-timer notification.** Phone timers freeze in the background, so the end of a rest also
  fires a "Rest over" notification — allow it from Settings or on your first logged set. On iOS
  that needs the app installed to the home screen (iOS 16.4+).
- **Persistent storage** is requested at launch so the browser will not evict the log. Settings →
  About shows whether it was granted, along with the active programme and its week shape.
- **Warm-up sets.** "+ Warm-up set" adds a dimmed row above the working sets, pre-filled at half
  the suggested load and resting half as long (30 s minimum). Logged, never counted: they stay out
  of progression, volume, top sets and the muscle tallies.
- **To failure.** The **F** button beside the reps field marks a set as taken to failure. It is
  recorded and reported, and it is deliberately inert — set facts never move a suggestion.
- **Progression schemes.** Each exercise picks how its load advances (Programme → Progression):
  *double progression* (the default — add the increment once every set hits the top of the range),
  *linear* (add it once every set clears the bottom), *tracking only* (repeat the last load, no
  suggestion), or *best time* for conditioning, which pre-fills the fastest time you have logged.
- **Stall response is yours, and one-off.** After two regressing sessions the "stalled" marker
  becomes tappable: *Deload 10%*, *Bottom of range*, or *Keep the suggestion*. Nothing is offered
  unprompted and nothing happens on its own; whichever you pick pre-fills the next session only and
  is dropped as soon as the exercise is logged again.
- **Per-exercise rest and notes.** An exercise can carry its own rest time (otherwise the Settings
  default for its type) and a setup note — "seat 4, handles narrow" — shown under its name in
  Session.
- **Plate calculator.** On a barbell exercise loaded as a total, tapping the **kg** suffix shows
  the per-side breakdown against your bar and plates (Settings → Plates), and what is left over
  when the number is unreachable.
- **Finish summary.** Ending a session shows duration, sets, volume and a line per exercise, with
  "↑ from 60 kg" wherever the top set beat the last one.
- **Backup note.** Today shows one muted line when the last export is more than a fortnight old.
- **Past sessions are editable.** History → expand a session → expand an exercise to correct or
  delete any set, and edit the session note.
- **Records.** History → Records lists your best numbers per exercise, and each exercise's own
  screen repeats them with the date: best estimated 1RM (Epley, sets of 1–12), heaviest set, best
  session volume, most reps, longest hold, or fastest time, whichever the movement can hold. Loads
  are compared in the exercise's current denomination, and warm-ups never count.
- **PRs.** A logged working set that beats one of those reads "PR" beside its number, and the
  finish summary lists what the session put in the book. Records start from your **second** session
  of an exercise — a first is a number, not a record — and none of it moves a load suggestion.
- **Muscle report.** History → Muscles shows weekly sets per muscle over 1, 4 or 8 weeks — 1 per
  primary muscle of the library entry, 0.5 per secondary, averaged over the weeks that trained —
  plus the week-by-week total and the push:pull and squat:hinge ratios. A shaded 10–20 hard-set band
  sits behind the chart as a reference (editable in Settings). Sets whose exercise has no library
  link are called out and counted nowhere.

## Backup and restore

Everything lives in this browser's IndexedDB — clearing site data or deleting the app deletes the
log, so back it up from **Settings → Backup**:

- **Export JSON** saves `workout-log-YYYY-MM-DD.json`. **Copy to clipboard** is the fallback for
  installed PWAs that block downloads — paste it into a note or a file.
- **Import JSON** *merges*: rows whose id already exists are kept, never overwritten, so
  re-importing the same file is a no-op and importing a phone backup onto a laptop just adds what
  is missing. Programmes and their days come along; a backup from before programmes existed joins
  whichever one is active. The result reads e.g. "Imported 3 sessions, 24 sets, skipped 0."
- **Wipe all data** (Danger zone) clears every session, set and programme, then re-seeds the
  stock one.

## Deploy

**GitHub Pages is already wired up** by [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml):
every push to `main` runs the tests, builds and deploys `dist/`. One-time setup: repository
**Settings → Pages → Source: "GitHub Actions"**. The site lives at `https://<user>.github.io/<repo>/`
— `base: './'` and the `HashRouter` mean the subpath needs no configuration. Alternatives:
`npx vercel --prod`, or drag `dist/` onto Netlify. Any static host works.

## Layout

- `src/db/` — Dexie schema, types, presets, seed and every data-access function (`repo.ts`).
  Screens never touch Dexie directly.
- `src/logic/` — pure, tested rules: progression, stall detection, the rotation walk and clash
  rule (`nextSession.ts`, `days.ts`), volume maths, formatting.
- `src/screens/` — one file per screen, with a folder of helpers next to the bigger ones.
- `src/components/` — shared primitives (Button, NumberField, Card, Chip, PageHeader, Sheet).

Icons in `public/` are generated placeholders; replace them with real artwork when there is any.
