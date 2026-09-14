# Workout Log

A single-user, offline-first PWA for whatever split you run — log sets in the gym with no
signal, and let it tell you when to add weight. No accounts, no backend, no sync.

Full requirements: [`workout-tracker-spec.md`](./workout-tracker-spec.md).

## Programmes

A **programme** is a list of *days* plus a *rotation*. A day has a name and split tags (`upper`,
`lower`, `push`, `pull`, `legs`, body parts, `cardio`); the rotation is an ordered strip of those
days and **rest** slots, e.g. `L · U · rest · L · U · rest · rest`. Nothing is pinned to a weekday:
Today walks the rotation from the slot the last session *of that programme* came from, and **each
rest slot elapses with one calendar day** — two of them read "Rest day 1 of 2", then "2 of 2",
then the next training day. A rest day is only a suggestion: **Train anyway** is one tap.

The **same kind of day** rule: if the day that comes up shares its tag set with a session you
finished in the last 24 hours, Today skips to the first day that does not and says why — Push and
Pull never clash, Lower A and Lower B do. *Choose a different session* overrides it, and notes
which days are the same kind as what you just trained.

Several programmes can be saved — exactly one is **active**, and it drives Today, the pickers and
the library's "appears in" hints. Build one on **Programme → Programmes**, duplicate an existing
one, or start from a preset: Upper/Lower 4-day, PPL 6-day, PPL 3-day, Full body 3-day, Body-part
5-day. Renaming, reordering or retiring a day never rewrites history — a session stores the day's
name and its exercises as prescribed that morning.

Progression: by default, when **every** set of an exercise hit the top of its rep range last
session, the next suggested load goes up by that exercise's increment (+5 kg on machines and the
bar, +2.5 kg per hand on dumbbells; bands and bodyweight items just track reps) — see *Progression
schemes* below for the other three rules. Each exercise is denominated in kg or **lb** on its own,
and volume totals always convert to kilograms. Suggestions are pre-filled, never forced. Every
exercise is editable on the **Programme** tab, scheme, rest and setup note included.

## The exercise library

*Library*, beside *Days* on the **Programme** tab, is the catalogue behind every exercise: what
each movement trains (primary and secondary muscles) and how it is loaded (equipment, pattern,
unilateral, default unit and measure). Filter by split tag, muscle or name; tap an entry to add it
to a day, edit it or retire it (retired entries leave the pickers; old rows and sets keep
resolving). Adding or swapping picks from here, so the row inherits the movement's defaults — a
custom, unlinked exercise is one link away at the bottom of the picker.

## Stack and scripts

Vite + React 19 + TypeScript + Tailwind v4, Dexie (IndexedDB) for storage, Recharts for the history
charts, `vite-plugin-pwa` for the manifest and service worker, Vitest for the logic tests. Routing
is a `HashRouter`, so URLs look like `#/`, `#/history`, `#/programme` and work from any subpath.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc --noEmit && vite build -> dist/
npm test         # Vitest, single run — 599 of them
```

Also: `npm run preview`, `test:watch`, `typecheck`, `lint`, `gen:icons`.

**Install it on your phone.** The service worker only runs in a real build, so
`npm run build && npm run preview` (or the deployed URL) — not the dev server. **Android /
Chrome**: menu **⋮ → Install app** (Settings → About offers one too). **iOS**: Safari's **Share →
Add to Home Screen**, the only route there. Installed, it runs full-screen and in aeroplane mode.

## Gym-friendly extras

- **The screen stays on** while a session is open (Settings → During a session turns it off), and
  **persistent storage** is requested at launch so the browser will not evict the log.
- **Rest-timer notification.** Phone timers freeze in the background, so the end of a rest also
  fires a "Rest over" notification — allow it from Settings or on your first logged set (iOS needs
  the app on the home screen, 16.4+).
- **Warm-up sets.** "+ Warm-up set" adds a dimmed row above the working sets, pre-filled at half
  the suggested load and resting half as long (30 s minimum). Logged, never counted: they stay out
  of progression, volume, top sets, records and the muscle tallies.
- **To failure.** The **F** button marks a set as taken to failure. Recorded and reported, and
  deliberately inert — set facts never move a suggestion.
- **Progression schemes** (Programme → Progression): *double progression* (the default — add the
  increment once every set hits the top of the range), *linear* (once every set clears the bottom),
  *tracking only* (repeat the last load), or *best time* for conditioning, which pre-fills the
  fastest time you have logged.
- **Stall response is yours, and one-off.** After two regressing sessions the "stalled" marker
  becomes tappable: *Deload 10%*, *Bottom of range*, or *Keep the suggestion*. Whichever you pick
  pre-fills the sets you have not logged yet and is dropped the moment the exercise is logged.
  The marker never appears on work scored on the clock, where a falling number is progress.
- **Per-exercise rest and notes.** An exercise can carry its own rest time (otherwise the Settings
  default for its type) and a setup note — "seat 4, handles narrow" — shown under its name.
- **Plate calculator.** On a barbell exercise loaded as a total, tapping the **kg** suffix shows
  the per-side breakdown against your bar and plates (Settings → Plates), and what is left over.
- **Skip, reorder and swap — for today.** The ⋯ beside any exercise in the session overview skips
  it, moves it one place, or swaps it for a library movement for this session only. It all goes
  into the session's own snapshot, so next week's day is untouched; a swapped-in exercise logs sets
  normally and reads "(today only)" in History. Skipping after a set is already in keeps that set:
  it still counts, and History shows it under a "skipped" mark.
- **Live duration** in the session header, mm:ss and then hh:mm:ss.
- **Calendar.** History → Sessions opens on this month, a dot per finished session on the days you
  trained. Tapping a trained day filters the list to it; ‹ › walk the months. No streak, no score.
- **Finish summary.** Ending a session shows duration, sets, volume, a line per exercise with
  "↑ from 60 kg" wherever the top set beat the last one, and the records it put in the book.
- **Backup note.** Today shows one muted line when the last export is more than a fortnight old.
- **Past sessions are editable.** History → expand a session → expand an exercise to correct or
  delete any set, and to edit the session note.
- **Records.** History → Records lists your best numbers per exercise, and each exercise's own
  screen repeats them with the date: best estimated 1RM (Epley, sets of 1–12), heaviest set, best
  session volume, most reps, longest hold or fastest time, whichever the movement can hold. Loads
  compare in the exercise's current denomination, warm-ups never count, and the numbers stay the
  exercise's own — the bodyweight option below never rewrites them.
- **PRs.** A logged working set that beats one of those reads "PR" beside its number. Records
  start from your **second** session of an exercise — a first is a number, not a record — and none
  of it moves a load suggestion.
- **Bodyweight in volume.** Off by default; the switch is on History → Weight. On, a bodyweight
  exercise counts your weight × reps (plus any belt) towards session volume, using the latest
  weigh-in at or before that session. Per-exercise charts and records stay in their own numbers.
- **Muscle report.** History → Muscles shows weekly sets per muscle over 1, 4 or 8 weeks — 1 per
  primary muscle of the library entry, 0.5 per secondary, averaged over the weeks that trained —
  plus the week-by-week total, the push:pull and squat:hinge ratios, and a shaded 10–20 hard-set
  reference band (editable in Settings). Unlinked sets are called out and counted nowhere.
- **Weekly review, on demand.** *Review this window* sorts every muscle against that band — under,
  over, in range — and, for the ones that came up short, offers the library movements you are not
  already running, with an explicit **Add to day**. Never shown unasked, changes nothing by itself.

## Backup and restore

Everything lives in this browser's IndexedDB — clearing site data or deleting the app deletes the
log. Back it up from **Settings → Backup**:

- **Export JSON** saves `workout-log-YYYY-MM-DD.json`. **Copy to clipboard** is the fallback for
  installed PWAs that block downloads — paste it into a note or a file.
- **Import JSON** *merges*: rows whose id already exists are kept, never overwritten, so
  re-importing the same file is a no-op and a phone backup onto a laptop adds only what is missing.
  Programmes and days come along; a backup from before programmes existed joins whichever one is
  active. The result reads e.g. "Imported 3 sessions, 24 sets, skipped 0."
- **Automatic backup** (Android Chrome, and Chromium on the desktop) writes the same JSON into a
  folder you pick once, at most weekly, when you open the app; it keeps the eight newest files and
  never prompts on its own. **Back up now** forces one. Safari and Firefox have no equivalent, and
  say so.
- **Wipe all data** (Danger zone) clears every session, set and programme, then re-seeds the
  stock one.

## Deploy

**GitHub Pages is already wired up** by [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml):
every push to `main` runs the tests, builds and deploys `dist/`. One-time setup: repository
**Settings → Pages → Source: "GitHub Actions"**. `base: './'` and the `HashRouter` mean any static
host works with no configuration — `npx vercel --prod` or `dist/` on Netlify too.

## Layout

- `src/db/` — Dexie schema, types, presets, seed and every data-access function (`repo.ts`);
  screens never touch Dexie directly.
- `src/logic/` — pure, tested rules: progression schemes, stall detection, records, the rotation
  walk and clash rule (`nextSession.ts`, `days.ts`), volume maths, formatting.
- `src/screens/` — one file per screen, with a folder of helpers next to the bigger ones, and
  `src/components/` for the shared primitives (Button, NumberField, Card, Chip, Sheet).

Icons in `public/` are generated placeholders; replace them with real artwork when there is any.
