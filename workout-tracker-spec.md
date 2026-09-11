# Spec: Upper/Lower workout tracker (PWA)

Paste this into Claude Code (or Claude Design for the UI pass first). Build it in one go; ask me only if something below is contradictory.

## What it is
A single-user, offline-first workout logger for a fixed 4-day upper/lower programme. Runs as a PWA on my phone (installable from the browser, works with no signal in the gym). No accounts, no backend. All data in the browser (IndexedDB via localForage or Dexie), with JSON export/import so I can back it up.

## Stack
- Vite + React + TypeScript, Tailwind. No component library needed.
- PWA via `vite-plugin-pwa` (manifest + service worker, precache everything).
- Storage: Dexie (IndexedDB). Never localStorage for the log itself.
- Deploy target: static hosting (Vercel/Netlify/GitHub Pages). Add a one-line deploy note in the README.
- Mobile-first: designed for a ~390 px wide portrait screen, thumb-reachable controls, large tap targets. Dark theme default.

## The programme (seed data, editable in-app)
Week shape: Lower A → Upper A → rest → Lower B → Upper B → rest → rest. Days are not fixed to weekdays; the app just knows which session is "next". Rule: never suggest a lower day immediately after another lower day.

Each exercise has: name, sets, rep range (min–max, or a fixed number, or a time/distance for the non-lifting items), load unit (kg per side / kg total / band / bodyweight / none), and a flag `progression: "primary" | "accessory"`.

### Lower A — quad-led
| Exercise | Sets × Reps | Type |
|---|---|---|
| Hack squat (feet ahead, wide) | 4 × 8–10 | primary |
| Leg press | 3 × 12 | primary |
| Leg curl | 4 × 10 | accessory |
| Unilateral floor hip thrust | 3 × 15 each | accessory (bodyweight) |
| Seated abduction (band) | 3 × 25 | accessory (band) |
| Pallof press in/out | 3 × 10 each | accessory |
| Calf raises | 3 × 20–30 | accessory |

### Upper A — push-led
| Exercise | Sets × Reps | Type |
|---|---|---|
| DB incline bench | 4 × 8–10 | primary (kg per hand) |
| Seated row | 4 × 12 | primary |
| Seated DB OHP | 3 × 10 | accessory (kg per hand) |
| Hammer pulldown | 3 × 12 | accessory |
| DB laterals | 3 × 15 | accessory (kg per hand) |
| Pushdowns | 3 × 15 | accessory |
| Half side plank | 3 × 45 s each | accessory (time) |

### Lower B — hinge-led
| Exercise | Sets × Reps | Type |
|---|---|---|
| Barbell deadlift | 4 × 6–8 | primary |
| Leg extension | 3 × 15 | primary |
| Seated DB good morning | 3 × 10 | accessory |
| Leg curl | 3 × 12 | accessory |
| Single-leg raises | 3 × 15 each | accessory (bodyweight) |
| Calf raises | 3 × 20–30 | accessory |
| Row 1 km | — | conditioning (log time) |

### Upper B — pull-led
| Exercise | Sets × Reps | Type |
|---|---|---|
| Unilateral pulldown | 4 × 10 each | primary |
| DB flat bench | 4 × 10 | primary (kg per hand) |
| Cable straight-arm pulldown | 3 × 12 | accessory |
| Machine reverse fly | 3 × 12 | accessory |
| DB curls | 3 × 12 | accessory (kg per hand) |
| Farmer's walk | 3 laps | accessory (kg per hand, log laps) |
| Row 1 km | — | conditioning (log time) |

## Progression logic (the point of the app)
- **Primary**: if every set in the last logged session hit the *top* of the rep range, suggest +5 kg (hack squat, leg press, deadlift, seated row, pulldowns) or +2.5 kg per hand (DB presses) next time. Otherwise suggest the same load. Increments are per-exercise fields, editable.
- **Accessory**: suggest same load until every set hits the top of the range, then suggest the next increment (default +2.5 kg, or +1 kg per hand for DB laterals/curls; bands and bodyweight items just track reps).
- Suggestion is shown, never forced — I can override any set.
- If an exercise regresses two sessions in a row (fewer total reps at same load), show a small "stalled" marker. No automatic deloads.

## Screens
1. **Today** — shows the next session (name + exercise list). One tap to start. If I trained lower yesterday, it highlights the next *upper* session instead and says why.
2. **Session** — one exercise at a time, swipeable or next/prev. Per set: load field pre-filled with the suggestion, reps field pre-filled with target, big "✓ done" button. A rest timer starts automatically on set completion (default 120 s primary / 90 s accessory, editable) with a visible countdown and a vibrate/beep at zero. Show last session's numbers for that exercise inline ("last: 4×8 @ 70"). Finish button at the end; partial sessions are saved as you go so a crash loses nothing.
3. **History** — list of completed sessions, tap to expand. Per-exercise view with a simple line chart of top-set load over time and total volume (sets × reps × load) over time.
4. **Programme** — edit exercises (name, sets, rep range, unit, increment, type), reorder, add/remove, swap an exercise for another. Changes apply to future sessions only.
5. **Settings** — units (kg only for now, but keep it a setting), rest-timer defaults, export JSON, import JSON (merge, not overwrite), wipe data with confirmation.

## Data model (sketch)
```
Exercise { id, name, sets, repMin, repMax, unit, increment, type, order }
Session  { id, templateId, startedAt, finishedAt?, notes? }
SetLog   { id, sessionId, exerciseId, setIndex, load, reps, completedAt }
Settings { restPrimary, restAccessory, units }
```

## Nice-to-haves (do after the core works)
- Bodyweight log with a weekly average chart (I'm on a cut; I'll enter it manually).
- Optional session note field.
- Home-screen widget-style summary is out of scope; PWA install is enough.

## Non-goals
No social features, no cloud sync, no exercise library/videos, no AI coaching. It's a fast logger with a progression rule.
