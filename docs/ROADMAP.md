# Workout Log — feature expansion plan

_Last updated 2026-09-14. Source of truth for what comes next; edit freely._

## Where things stand

Shipped and live at https://agoculdas.github.io/workout-log/:

- **v1.0** — the original spec: 4-day upper/lower programme, double progression rule, stalled marker, session logger with rest timer, history + charts, programme editor, JSON backup, PWA.
- **v1.1** — gym extras: screen wake lock, background rest notification, persistent storage, editing past sessions, per-session exercise snapshots.
- **v1.2** — exercise library (44 movements with muscles, equipment, pattern, split tags), library-based add/swap, sets-per-muscle report with push:pull and squat:hinge balance.
- **v1.3 (Phase 1, shipped 2026-09-13)** — warm-up sets, to-failure marker, per-exercise kg/lb, plate calculator, finish summary, quiet backup line, sets-per-muscle reference band, library rough edges.
- **v2.0 (Phase 2, shipped 2026-09-13)** — programmes with rotations and rest days, user-defined days with split tags, several saved programmes with one active, five presets, same-kind clash rule, rest days that elapse per calendar day, Dexie v3 migration.

- **v2.1 (3.2, shipped 2026-09-13)** — personal records: e1RM, heaviest set, most reps, longest hold, best time, best session volume; PR marks in Session, records in the finish summary, exercise history, and a Records tab in History.
- **v2.2 (shipped 2026-09-14)** — progression schemes per exercise with a hand-picked stall answer (3.3), the on-demand weekly review under Muscles (3.4), per-exercise rest and notes (4.2), skip / reorder / swap-for-today (4.3), live session duration and a History calendar (4.4, no streak), bodyweight in volume (4.5), and automatic weekly backup to a folder on Android Chrome (5.3).

599 tests. Verified on a real phone up to v1.2.

**Effort scale used below.** S = a few files, under an hour of agent time. M = one agent session, a few hundred lines. L = multi-agent build with a schema migration, like the library was.

---

## Phase 1 — Small wins and hardening (shipped)

Low risk, no schema migration except new settings fields. One session of work for the whole phase.

### 1.1 Backup nudge — S
- **Why.** Data lives only on the phone. Nothing reminds you to export.
- **Data.** `Settings.lastExportAt?: number`, set by Export and Copy in Settings.
- **Screens.** Today shows a quiet banner when the last export is older than 14 days (or never): "Last backup 3 weeks ago · Export". Tap goes to Settings.

### 1.2 Warm-up sets — S/M
- **Why.** Warm-ups currently either go unlogged or pollute progression and volume.
- **Data.** `SetLog.kind: 'working' | 'warmup'` (default working; old rows treated as working).
- **Rules.** Warm-ups are excluded from `suggestLoad`, `isStalled`, volume, top-set, and muscle tallies.
- **Screens.** Session: "+ warm-up set" per exercise inserts a muted row above the working sets, with load pre-filled at 50% of the working suggestion. History shows them dimmed.

### 1.3 Plate calculator — S
- **Why.** Barbell loads at 5 kg jumps are easy; the 2.5 and 1.25 combinations are not.
- **Data.** `Settings.barWeight` (default 20) and `Settings.plates` (default 25, 20, 15, 10, 5, 2.5, 1.25).
- **Screens.** On exercises whose library entry is barbell equipment, tapping the load field's suffix opens a small sheet: per-side breakdown, e.g. "per side: 20 · 10 · 2.5".

### 1.4 Rough edges from the library work — S
- Dismissing the "also rename N programme exercises?" dialog by tapping outside currently saves without propagating. Add a third outcome to `ConfirmDialog` (dismiss is not cancel) or make the sheet explicit.
- Swap from a reps exercise to a timed one carries the rep range across. Reset the target to the incoming entry's default when the measure changes.
- Muscles report chips use the shared `Chip` component.

### 1.5 Session summary on Finish — S
- After Finish, a summary sheet: duration, sets logged, total volume, exercises where you progressed. Becomes the home for PR badges once 3.2 exists.

---

## Phase 2 — Custom programme structure (shipped)

**Goal.** Run any split: push/pull/legs, body-part, full body, or your upper/lower. Today's four days and their order are hard-coded; the library tags were built so this can be data instead.

### Data (Dexie v3)
- `Template` becomes user-defined: `{ id: string; name: string; tags: SplitTag[]; order: number; archived?: boolean }`. The `TemplateId` union type becomes `string`. This is the pervasive change; it touches `nextSession`, Today, Programme, seed, repo, and their tests.
- New `Programme { id; name; rotation: RotationSlot[]; active: boolean }` where `RotationSlot = { templateId } | { rest: true }`. Several programmes can be saved; exactly one is active. Example: "Upper/Lower cut" and "PPL bulk".
- `Session` gains `templateName` in its snapshot so history survives renames and deletions.
- Migration converts the current four templates into rows and creates one active programme with the rotation Lower A → Upper A → rest → Lower B → Upper B → rest → rest.

### Rules
- **Next session.** Find the rotation slot of the last completed session (most recent occurrence of its template), then walk forward. Rest slots are informational: Today shows "Rest day suggested" with "Train anyway" that jumps to the next training day.
- **Clash rule** generalises "no lower after lower": if the next day shares any split tag with a session finished in the last 24 hours, skip forward to the first day that doesn't and say why. Still overridable via the picker.
- Days are not tied to weekdays, as before.

### Screens
- **Programme → Days**: add a day (name + tags), rename, reorder, delete (archives; sessions keep their snapshot).
- **Programme → Rotation**: an ordered strip of day chips and rest chips with up/down and remove. Shows the resulting week shape, e.g. "L · U · rest · L · U · rest · rest".
- **Programme → Programmes**: list of saved programmes, "Make active", duplicate, delete. **Presets** sheet builds one from the library with sensible sets and reps: Upper/Lower 4-day (current), PPL 6-day, PPL 3-day, Full body 3-day, Body-part 5-day.
- **Today**: "Day 4 of 7 · Lower B", or the rest-day state.
- Muscles report and History need no change; Library "Add to day" lists the active programme's days.

### Size and risk
- **L.** Same shape as the library build: data agent first, then two UI agents, then integration.
- Risks: the `TemplateId` type change is wide; export/import must accept v2 bundles (fixed four templates) and v3 bundles; the clash rule needs tests against every preset.

---

## Phase 3 — Progression and insight

### 3.1 RPE / RIR per set — S/M
- **Why.** Reps-in-reserve is the cheapest signal for whether a top-of-range session was actually easy.
- **Data.** `SetLog.rir?: number` (0–5). Off by default; toggle in Settings.
- **Screens.** A row of small chips (0 1 2 3 4+) after the done button, optional.
- **Rules.** Initially display only. Optional later: don't bump load if average RIR was 0.

### 3.2 Personal records — M (shipped 2026-09-13)
- **Why.** Progression is per session; PRs give the long view and a reason to push a set.
- **Data.** None. Computed from set logs: best e1RM (Epley: load × (1 + reps ÷ 30)), heaviest set, best session volume, per exercise.
- **Screens.** "PR" badge on the set in Session when it beats the record; PR line in ExerciseHistory header; a PR list in History; PRs in the Finish summary (1.5).

### 3.3 Progression schemes and stall response — M (shipped 2026-09-14)
- **Data.** `Exercise.scheme: 'double' | 'linear' | 'none' | 'best-time'`. Double is today's rule; linear bumps whenever every set hits the minimum; none just tracks; best-time suggests beating the last time for conditioning.
- **Rules.** Tapping the stalled marker opens a sheet with three answers: "Deload 10%", "Bottom of range", or "Keep the suggestion". Never automatic; whichever you pick pre-fills the sets you have not logged yet and is dropped once the exercise is logged (`finishSession`).
- **Shipped as:** the marker only appears where reps are the measure — `stallApplies` keeps it off conditioning and `best-time` rows, where a falling number is progress.

### 3.4 Weekly review — M (shipped 2026-09-14)
- **Why.** The Muscles report shows numbers; this turns them into a decision.
- **Data.** `Settings.setsPerMuscleTarget: { min: 10, max: 20 }`, optionally per muscle.
- **Screens.** On demand in History → Muscles: muscles under target, muscles over, and library entries whose primary muscle is under-served, with "Add to day". **No Today card**, per decision 4 — nothing is offered unprompted.

---

## Phase 4 — Session quality of life

### 4.1 Supersets — M (not now, by decision)
- `Exercise.groupId?: string`. Grouped exercises alternate in Session (A1, B1, A2, B2…) with one rest timer per round. Programme editor: "Pair with…".
- **Decision 5 stands: not now.** The programme does not use them, and the pager would have to grow a second axis. Revisit only if the split changes.

### 4.2 Per-exercise rest and notes — S (shipped 2026-09-14)
- `Exercise.restOverride?: number` and `Exercise.note?: string` ("seat 4, handles narrow"). Both shown in Session.

### 4.3 Skip, reorder, and swap for today — M (shipped 2026-09-14)
- In Session: skip an exercise (recorded as skipped, no sets), move it later, or "swap for today only" from the library without touching the programme. The session snapshot already makes this safe.

### 4.4 Duration and calendar — S/M (shipped 2026-09-14, no streak)
- Live session duration in the header. History gets a month calendar with trained days marked. **No streak, by decision** — the calendar says what happened, it does not keep score.

### 4.5 Bodyweight in volume — S (shipped 2026-09-14)
- Option to count bodyweight × reps for bodyweight exercises, using the latest bodyweight entry.

---

## Phase 5 — Data and portability

### 5.1 Pounds — M (superseded by decision 6, shipped in Phase 1)
- Shipped as a *per-exercise* denomination (`Exercise.massUnit`), not a global switch: a rack marked in lb is one exercise's business, and volume totals convert to kilograms. A global switch is not planned.

### 5.2 Import from other apps — M
- CSV import for Strong and Hevy exports, mapping their exercise names onto the library with a review step for unmatched names. Only worth it if you have old data.

### 5.3 Automatic backup — M (shipped 2026-09-14)
- Android Chrome: File System Access API to write the export to a chosen folder every week. iOS: no equivalent; keep the nudge (1.1).

### 5.4 Sync — still a non-goal
- Multi-device sync would need a backend or a CRDT layer and a login. Out of scope unless that changes; export/import is the deliberate answer.

---

## Recommended order

1. ~~Phase 1~~ shipped.
2. ~~Phase 2~~ shipped.
3. ~~3.2 PRs, 3.3 schemes and stall response, 3.4 weekly review~~ shipped. (3.1 RIR was replaced by the to-failure button.)
4. ~~4.2 rest and notes, 4.3 skip/reorder/swap, 4.4 duration and calendar, 4.5 bodyweight in volume~~ shipped. **4.1 supersets: not now, by decision.**
5. ~~5.3 automatic backup~~ shipped. The rest of **Phase 5** only when a concrete need appears.

## Decisions (taken 2026-09-13)

1. **Rest days** are informational slots in the rotation.
2. **Programmes**: several saved, all editable in place, exactly one active. No separate "edit mode"; delete is the only action behind a confirm, and nothing destructive sits near session controls.
3. **Presets**: ship the five listed; nothing custom seeded.
4. **Set facts never drive suggestions.** "To failure" is a per-set button (replaces RIR chips). No nagging anywhere: the backup note is one muted line, the weekly review is on demand only, no suggestion cards on Today.
5. **Supersets**: not now.
6. **Pounds** are a per-exercise denomination (`Exercise.massUnit`), because some machines are marked in lb. Not a global switch. Moved into Phase 1. Imports: no.
7. **Sets per muscle**: default band 10–20 hard sets per week, shown as a reference band on the Muscles chart, editable, silent.

**Implementation**: grunt work runs on cheaper (Sonnet) agents from precise briefs; the lead plans and verifies.

## Non-goals, unchanged

No accounts, no cloud, no social features, no exercise videos, no AI coaching. It stays a fast logger with a progression rule.
