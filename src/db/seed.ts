import type { Exercise, Settings, Template } from './types';

/**
 * Seed rows use stable slug ids (not random UUIDs) so that an export from one
 * device merges cleanly into another device's seeded database instead of
 * duplicating the whole programme. User-created rows use crypto.randomUUID().
 */

export const SEED_TEMPLATES: Template[] = [
  { id: 'lowerA', name: 'Lower A', kind: 'lower', order: 0 },
  { id: 'upperA', name: 'Upper A', kind: 'upper', order: 1 },
  { id: 'lowerB', name: 'Lower B', kind: 'lower', order: 2 },
  { id: 'upperB', name: 'Upper B', kind: 'upper', order: 3 },
];

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  restPrimary: 120,
  restAccessory: 90,
  units: 'kg',
};

type SeedExercise = Omit<Exercise, 'order' | 'measure' | 'perSide' | 'archived'> &
  Partial<Pick<Exercise, 'measure' | 'perSide'>>;

const raw: SeedExercise[] = [
  // ---------------- Lower A — quad-led ----------------
  { id: 'ex_hack_squat', templateId: 'lowerA', name: 'Hack squat (feet ahead, wide)', sets: 4, repMin: 8, repMax: 10, unit: 'kg_total', increment: 5, type: 'primary' },
  { id: 'ex_leg_press', templateId: 'lowerA', name: 'Leg press', sets: 3, repMin: 12, repMax: 12, unit: 'kg_total', increment: 5, type: 'primary' },
  { id: 'ex_leg_curl_a', templateId: 'lowerA', name: 'Leg curl', sets: 4, repMin: 10, repMax: 10, unit: 'kg_total', increment: 2.5, type: 'accessory' },
  { id: 'ex_uni_hip_thrust', templateId: 'lowerA', name: 'Unilateral floor hip thrust', sets: 3, repMin: 15, repMax: 15, unit: 'bodyweight', increment: 0, type: 'accessory', perSide: true },
  { id: 'ex_seated_abduction', templateId: 'lowerA', name: 'Seated abduction (band)', sets: 3, repMin: 25, repMax: 25, unit: 'band', increment: 0, type: 'accessory' },
  { id: 'ex_pallof_press', templateId: 'lowerA', name: 'Pallof press in/out', sets: 3, repMin: 10, repMax: 10, unit: 'kg_total', increment: 2.5, type: 'accessory', perSide: true },
  { id: 'ex_calf_raises_a', templateId: 'lowerA', name: 'Calf raises', sets: 3, repMin: 20, repMax: 30, unit: 'kg_total', increment: 2.5, type: 'accessory' },

  // ---------------- Upper A — push-led ----------------
  { id: 'ex_db_incline_bench', templateId: 'upperA', name: 'DB incline bench', sets: 4, repMin: 8, repMax: 10, unit: 'kg_side', increment: 2.5, type: 'primary' },
  { id: 'ex_seated_row', templateId: 'upperA', name: 'Seated row', sets: 4, repMin: 12, repMax: 12, unit: 'kg_total', increment: 5, type: 'primary' },
  { id: 'ex_seated_db_ohp', templateId: 'upperA', name: 'Seated DB OHP', sets: 3, repMin: 10, repMax: 10, unit: 'kg_side', increment: 2.5, type: 'accessory' },
  { id: 'ex_hammer_pulldown', templateId: 'upperA', name: 'Hammer pulldown', sets: 3, repMin: 12, repMax: 12, unit: 'kg_total', increment: 2.5, type: 'accessory' },
  { id: 'ex_db_laterals', templateId: 'upperA', name: 'DB laterals', sets: 3, repMin: 15, repMax: 15, unit: 'kg_side', increment: 1, type: 'accessory' },
  { id: 'ex_pushdowns', templateId: 'upperA', name: 'Pushdowns', sets: 3, repMin: 15, repMax: 15, unit: 'kg_total', increment: 2.5, type: 'accessory' },
  { id: 'ex_half_side_plank', templateId: 'upperA', name: 'Half side plank', sets: 3, repMin: 45, repMax: 45, unit: 'bodyweight', increment: 0, type: 'accessory', measure: 'seconds', perSide: true },

  // ---------------- Lower B — hinge-led ----------------
  { id: 'ex_deadlift', templateId: 'lowerB', name: 'Barbell deadlift', sets: 4, repMin: 6, repMax: 8, unit: 'kg_total', increment: 5, type: 'primary' },
  { id: 'ex_leg_extension', templateId: 'lowerB', name: 'Leg extension', sets: 3, repMin: 15, repMax: 15, unit: 'kg_total', increment: 5, type: 'primary' },
  { id: 'ex_seated_db_good_morning', templateId: 'lowerB', name: 'Seated DB good morning', sets: 3, repMin: 10, repMax: 10, unit: 'kg_total', increment: 2.5, type: 'accessory' },
  { id: 'ex_leg_curl_b', templateId: 'lowerB', name: 'Leg curl', sets: 3, repMin: 12, repMax: 12, unit: 'kg_total', increment: 2.5, type: 'accessory' },
  { id: 'ex_single_leg_raises', templateId: 'lowerB', name: 'Single-leg raises', sets: 3, repMin: 15, repMax: 15, unit: 'bodyweight', increment: 0, type: 'accessory', perSide: true },
  { id: 'ex_calf_raises_b', templateId: 'lowerB', name: 'Calf raises', sets: 3, repMin: 20, repMax: 30, unit: 'kg_total', increment: 2.5, type: 'accessory' },
  { id: 'ex_row_1km_b', templateId: 'lowerB', name: 'Row 1 km', sets: 1, repMin: 0, repMax: 0, unit: 'none', increment: 0, type: 'conditioning', measure: 'seconds' },

  // ---------------- Upper B — pull-led ----------------
  { id: 'ex_uni_pulldown', templateId: 'upperB', name: 'Unilateral pulldown', sets: 4, repMin: 10, repMax: 10, unit: 'kg_total', increment: 5, type: 'primary', perSide: true },
  { id: 'ex_db_flat_bench', templateId: 'upperB', name: 'DB flat bench', sets: 4, repMin: 10, repMax: 10, unit: 'kg_side', increment: 2.5, type: 'primary' },
  { id: 'ex_straight_arm_pulldown', templateId: 'upperB', name: 'Cable straight-arm pulldown', sets: 3, repMin: 12, repMax: 12, unit: 'kg_total', increment: 2.5, type: 'accessory' },
  { id: 'ex_machine_reverse_fly', templateId: 'upperB', name: 'Machine reverse fly', sets: 3, repMin: 12, repMax: 12, unit: 'kg_total', increment: 2.5, type: 'accessory' },
  { id: 'ex_db_curls', templateId: 'upperB', name: 'DB curls', sets: 3, repMin: 12, repMax: 12, unit: 'kg_side', increment: 1, type: 'accessory' },
  { id: 'ex_farmers_walk', templateId: 'upperB', name: "Farmer's walk", sets: 3, repMin: 1, repMax: 1, unit: 'kg_side', increment: 2.5, type: 'accessory', measure: 'laps' },
  { id: 'ex_row_1km_ub', templateId: 'upperB', name: 'Row 1 km', sets: 1, repMin: 0, repMax: 0, unit: 'none', increment: 0, type: 'conditioning', measure: 'seconds' },
];

const orderCounters: Record<string, number> = {};

export const SEED_EXERCISES: Exercise[] = raw.map((e) => {
  const order = orderCounters[e.templateId] ?? 0;
  orderCounters[e.templateId] = order + 1;
  return {
    ...e,
    order,
    measure: e.measure ?? 'reps',
    perSide: e.perSide ?? false,
    archived: false,
  };
});
