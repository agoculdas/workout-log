/**
 * Mass denominations. Pounds are a *per-exercise* denomination, not a global
 * switch: some machines and dumbbell racks are marked in lb, everything else
 * in the same gym is in kg. A load is stored in the denomination it was
 * entered in and stamped onto the set, so history never silently re-reads.
 */
import { KG_PER_LB } from '../db/types';
import type { Exercise, LoadUnit, MassUnit, SetLog } from '../db/types';

/** A value in `unit` expressed in kilograms. */
export function toKg(value: number, unit: MassUnit): number {
  return unit === 'lb' ? value * KG_PER_LB : value;
}

/** Kilograms expressed in `unit`. */
export function fromKg(kg: number, unit: MassUnit): number {
  return unit === 'lb' ? kg / KG_PER_LB : kg;
}

/** The suffix a bare number gets: "kg" or "lb". */
export function massLabel(unit: MassUnit): 'kg' | 'lb' {
  return unit === 'lb' ? 'lb' : 'kg';
}

/** The denomination an exercise is loaded in. Absent (or missing row) is kg. */
export function exerciseMassUnit(
  exercise: Pick<Exercise, 'massUnit'> | undefined,
): MassUnit {
  return exercise?.massUnit === 'lb' ? 'lb' : 'kg';
}

/** The denomination a logged set was entered in. Absent is kg. */
export function setMassUnit(set: Pick<SetLog, 'massUnit'> | undefined): MassUnit {
  return set?.massUnit === 'lb' ? 'lb' : 'kg';
}

/**
 * The progression step a new exercise starts with, in its own denomination:
 * 2.5 kg or 5 lb for anything loaded in weight, 0 for band / bodyweight / none.
 */
export function defaultIncrement(loadUnit: LoadUnit, mass: MassUnit): number {
  if (loadUnit !== 'kg_side' && loadUnit !== 'kg_total') return 0;
  return mass === 'lb' ? 5 : 2.5;
}

/**
 * Snap a value to the nearest multiple of `step` (0.1-safe). `step <= 0`
 * returns the value untouched.
 */
export function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(step) || step <= 0) return value;
  const snapped = Math.round(value / step) * step;
  // Kill the float dust 0.1-style steps leave behind (7.000000000000001).
  return Number(snapped.toFixed(6));
}
