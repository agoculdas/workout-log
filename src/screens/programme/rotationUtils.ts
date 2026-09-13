/**
 * Pure list operations on a programme's rotation, plus the two summary lines
 * the Rotation editor prints. No Dexie, no DOM: the editor calls one of these,
 * gets a new array back, and hands it straight to `updateProgramme`.
 */
import type { Programme, RotationSlot, Template } from '../../db/types';
import { dayShortLabel } from '../../logic/days';
import type { ProgrammePreset } from '../../db/presets';

/** True for a rest slot. Narrows, so the training branch keeps `templateId`. */
export function isRest(slot: RotationSlot): slot is { rest: true } {
  return 'rest' in slot;
}

/**
 * Swap the slot at `index` with its neighbour. Out-of-range indices and moves
 * off either end return the original array, so the caller can call blind.
 */
export function moveSlot(
  rotation: readonly RotationSlot[],
  index: number,
  direction: -1 | 1,
): RotationSlot[] {
  const target = index + direction;
  if (index < 0 || index >= rotation.length) return [...rotation];
  if (target < 0 || target >= rotation.length) return [...rotation];
  const next = [...rotation];
  const moved = next[index]!;
  next[index] = next[target]!;
  next[target] = moved;
  return next;
}

/** Drop one slot. An index outside the list leaves the rotation alone. */
export function removeSlot(rotation: readonly RotationSlot[], index: number): RotationSlot[] {
  if (index < 0 || index >= rotation.length) return [...rotation];
  return rotation.filter((_, i) => i !== index);
}

/** Append a training day. */
export function addDaySlot(
  rotation: readonly RotationSlot[],
  templateId: string,
): RotationSlot[] {
  return [...rotation, { templateId }];
}

/** Append a rest day. */
export function addRestSlot(rotation: readonly RotationSlot[]): RotationSlot[] {
  return [...rotation, { rest: true }];
}

/**
 * How many slots actually train something. A slot whose day has been deleted
 * reads as rest everywhere else (`rotationShape`, `pickNextSession`), so it
 * does not count here either — pass the programme's days to enforce that.
 */
export function trainingDayCount(
  rotation: readonly RotationSlot[],
  templates?: readonly Template[],
): number {
  const usable = templates
    ? new Set(templates.filter((t) => !t.archived).map((t) => t.id))
    : undefined;
  return rotation.filter((slot) => !isRest(slot) && (!usable || usable.has(slot.templateId)))
    .length;
}

/** `"7 slots · 4 training days"`. Empty rotations get their own note instead. */
export function rotationSummary(
  rotation: readonly RotationSlot[],
  templates?: readonly Template[],
): string {
  const slots = rotation.length;
  const training = trainingDayCount(rotation, templates);
  return `${slots} slot${slots === 1 ? '' : 's'} · ${training} training day${
    training === 1 ? '' : 's'
  }`;
}

/**
 * The week shape of a *preset*, before any rows exist — same string
 * `rotationShape` prints for a saved programme, computed from the preset's own
 * day tags and rotation indices.
 */
export function presetShape(preset: Pick<ProgrammePreset, 'days' | 'rotation'>): string {
  return preset.rotation
    .map((slot) => {
      if (slot === 'rest') return 'rest';
      const day = preset.days[slot];
      return day ? dayShortLabel(day) : 'rest';
    })
    .join(' · ');
}

/** `"3 days"` — the day count shown next to a programme in the list. */
export function dayCountLabel(days: readonly Template[]): string {
  const count = days.filter((t) => !t.archived).length;
  return `${count} day${count === 1 ? '' : 's'}`;
}

/** The days belonging to one programme, in order. */
export function daysOf(
  programme: Pick<Programme, 'id'>,
  templates: readonly Template[],
): Template[] {
  return templates
    .filter((t) => t.programmeId === programme.id && !t.archived)
    .sort((a, b) => a.order - b.order);
}
