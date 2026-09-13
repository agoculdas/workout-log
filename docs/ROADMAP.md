# Workout Log — feature expansion plan

_Last updated 2026-09-13. Source of truth for what comes next; edit freely._

## Where things stand (v1.2)

Shipped and live at https://agoculdas.github.io/workout-log/:

- **v1.0** — the original spec: 4-day upper/lower programme, double progression rule, stalled marker, session logger with rest timer, history + charts, programme editor, JSON backup, PWA.
- **v1.1** — gym extras: screen wake lock, background rest notification, persistent storage, editing past sessions, per-session exercise snapshots.
- **v1.2** — exercise library (44 movements with muscles, equipment, pattern, split tags), library-based add/swap, sets-per-muscle report with push:pull and squat:hinge balance.

216 tests. Verified on a real phone.

**Effort scale used below.** S = a few files, under an hour of agent time. M = one agent session, a few hundred lines. L = multi-agent build with a schema migration, like the library was.

---

## Phase 1 — Small wins and hardening

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

## Phase 2 — Custom programme structure (the big one)

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

### 3.2 Personal records — M
- **Why.** Progression is per session; PRs give the long view and a reason to push a set.
- **Data.** None. Computed from set logs: best e1RM (Epley: load × (1 + reps ÷ 30)), heaviest set, best session volume, per exercise.
- **Screens.** "PR" badge on the set in Session when it beats the record; PR line in ExerciseHistory header; a PR list in History; PRs in the Finish summary (1.5).

### 3.3 Progression schemes and stall response — M
- **Data.** `Exercise.scheme: 'double' | 'linear' | 'none' | 'best-time'`. Double is today's rule; linear bumps whenever every set hits the minimum; none just tracks; best-time suggests beating the last time for conditioning.
- **Rules.** When the stalled marker shows, offer two buttons: "Deload 10%" (sets the suggestion, editable) or "Drop to bottom of range". Never automatic, as the spec says.

### 3.4 Weekly review — M
- **Why.** The Muscles report shows numbers; this turns them into a decision.
- **Data.** `Settings.setsPerMuscleTarget: { min: 10, max: 20 }`, optionally per muscle.
- **Screens.** A card on Today each Monday (or on demand in History → Muscles): muscles under target, muscles over, and library entries whose primary muscle is under-served, with "Add to day".

---

## Phase 4 — Session quality of life

### 4.1 Supersets — M
- `Exercise.groupId?: string`. Grouped exercises alternate in Session (A1, B1, A2, B2…) with one rest timer per round. Programme editor: "Pair with…".

### 4.2 Per-exercise rest and notes — S
- `Exercise.restOverride?: number` and `Exercise.note?: string` ("seat 4, handles narrow"). Both shown in Session.

### 4.3 Skip, reorder, and swap for today — M
- In Session: skip an exercise (recorded as skipped, no sets), move it later, or "swap for today only" from the library without touching the programme. The session snapshot already makes this safe.

### 4.4 Duration, calendar, streak — S/M
- Live session duration in the header. History gets a month calendar with trained days marked and a current-streak line.

### 4.5 Bodyweight in volume — S
- Option to count bodyweight × reps for bodyweight exercises, using the latest bodyweight entry.

---

## Phase 5 — Data and portability

### 5.1 Pounds — M
- Store kg internally, convert at display, and switch increments to 5 / 2.5 lb. Touches every formatter, the plate calculator, and the number-field steps. Only worth it if you'll ever train in an lb gym.

### 5.2 Import from other apps — M
- CSV import for Strong and Hevy exports, mapping their exercise names onto the library with a review step for unmatched names. Only worth it if you have old data.

### 5.3 Automatic backup — M
- Android Chrome: File System Access API to write the export to a chosen folder every week. iOS: no equivalent; keep the nudge (1.1).

### 5.4 Sync — still a non-goal
- Multi-device sync would need a backend or a CRDT layer and a login. Out of scope unless that changes; export/import is the deliberate answer.

---

## Recommended order

1. **Phase 1** in one go. Cheap, and 1.1 protects the data.
2. **Phase 2.** The largest item and the one that unlocks the library tags.
3. **3.2 PRs and 3.1 RIR**, then 3.3 and 3.4 as you feel the need.
4. **4.1 supersets** if your programme uses them; the rest of Phase 4 on demand.
5. **Phase 5** only when a concrete need appears.

## Decisions needed before Phase 2

1. **Rest days in the rotation**: informational slots as proposed, or a rotation of training days only?
2. **Multiple saved programmes** with one active, or a single editable one?
3. **Presets**: which of the five are worth shipping? Any specific programme you'd want seeded?
4. **RIR logging**: wanted, and should it ever affect load suggestions?
5. **Supersets**: do you run any today?
6. **Pounds** and **imports**: any real need?
7. **Sets-per-muscle target**: 10–20 per week as the default range?

## Non-goals, unchanged

No accounts, no cloud, no social features, no exercise videos, no AI coaching. It stays a fast logger with a progression rule.
