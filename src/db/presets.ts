/**
 * Ready-made programmes, built out of the stock catalogue.
 *
 * A preset is pure data: day names, split tags, and which catalogue movements
 * go on each day with how many sets and what rep range. `createProgrammeFromPreset`
 * in `repo.ts` turns one into real rows — the unit, measure, per-side flag and
 * increment all come from the catalogue entry and Settings, so an lb gym gets
 * lb increments without the preset knowing anything about it.
 *
 * Every `catalogId` here must exist in `SEED_CATALOG` (there is a test).
 */
import type { ExerciseType, SplitTag } from './types';

export interface PresetDay {
  name: string;
  tags: SplitTag[];
  exercises: Array<{
    catalogId: string;
    sets: number;
    repMin: number;
    repMax: number;
    type: ExerciseType;
  }>;
}

export interface ProgrammePreset {
  id: string;
  name: string;
  description: string;
  days: PresetDay[];
  /** Index into `days`, or a rest slot. */
  rotation: Array<number | 'rest'>;
}

/* ------------------------------------------------------------ shared days */

const PUSH_DAY: PresetDay = {
  name: 'Push',
  tags: ['upper', 'push'],
  exercises: [
    { catalogId: 'cat_barbell_bench_press', sets: 4, repMin: 6, repMax: 8, type: 'primary' },
    { catalogId: 'cat_seated_db_ohp', sets: 4, repMin: 8, repMax: 10, type: 'primary' },
    { catalogId: 'cat_db_incline_bench', sets: 3, repMin: 8, repMax: 10, type: 'accessory' },
    { catalogId: 'cat_cable_fly', sets: 3, repMin: 12, repMax: 15, type: 'accessory' },
    { catalogId: 'cat_db_laterals', sets: 3, repMin: 12, repMax: 15, type: 'accessory' },
    { catalogId: 'cat_pushdowns', sets: 3, repMin: 10, repMax: 15, type: 'accessory' },
  ],
};

const PULL_DAY: PresetDay = {
  name: 'Pull',
  tags: ['upper', 'pull'],
  exercises: [
    { catalogId: 'cat_barbell_row', sets: 4, repMin: 6, repMax: 8, type: 'primary' },
    { catalogId: 'cat_lat_pulldown', sets: 4, repMin: 8, repMax: 10, type: 'primary' },
    { catalogId: 'cat_seated_row', sets: 3, repMin: 10, repMax: 12, type: 'accessory' },
    { catalogId: 'cat_face_pull', sets: 3, repMin: 12, repMax: 15, type: 'accessory' },
    { catalogId: 'cat_db_curls', sets: 3, repMin: 10, repMax: 15, type: 'accessory' },
    { catalogId: 'cat_incline_db_curl', sets: 3, repMin: 10, repMax: 15, type: 'accessory' },
  ],
};

const LEGS_DAY: PresetDay = {
  name: 'Legs',
  tags: ['lower', 'legs'],
  exercises: [
    { catalogId: 'cat_back_squat', sets: 4, repMin: 6, repMax: 8, type: 'primary' },
    { catalogId: 'cat_romanian_deadlift', sets: 4, repMin: 8, repMax: 10, type: 'primary' },
    { catalogId: 'cat_leg_press', sets: 3, repMin: 10, repMax: 12, type: 'accessory' },
    { catalogId: 'cat_leg_curl', sets: 3, repMin: 10, repMax: 15, type: 'accessory' },
    { catalogId: 'cat_leg_extension', sets: 3, repMin: 10, repMax: 15, type: 'accessory' },
    { catalogId: 'cat_calf_raises', sets: 4, repMin: 10, repMax: 15, type: 'accessory' },
  ],
};

/** Presets share day shapes but never share objects: each gets its own copy. */
function copyDay(day: PresetDay): PresetDay {
  return {
    name: day.name,
    tags: [...day.tags],
    exercises: day.exercises.map((e) => ({ ...e })),
  };
}

/* ---------------------------------------------------------------- presets */

export const PRESETS: ProgrammePreset[] = [
  {
    id: 'upper_lower_4',
    name: 'Upper / Lower 4-day',
    description:
      'Two lower days and two upper days a week, quad-led then hinge-led. The stock programme.',
    days: [
      {
        name: 'Lower A',
        tags: ['lower', 'legs'],
        exercises: [
          { catalogId: 'cat_hack_squat', sets: 4, repMin: 8, repMax: 10, type: 'primary' },
          { catalogId: 'cat_leg_press', sets: 3, repMin: 10, repMax: 12, type: 'primary' },
          { catalogId: 'cat_leg_curl', sets: 4, repMin: 10, repMax: 12, type: 'accessory' },
          { catalogId: 'cat_unilateral_hip_thrust', sets: 3, repMin: 12, repMax: 15, type: 'accessory' },
          { catalogId: 'cat_seated_abduction', sets: 3, repMin: 15, repMax: 25, type: 'accessory' },
          { catalogId: 'cat_pallof_press', sets: 3, repMin: 10, repMax: 12, type: 'accessory' },
          { catalogId: 'cat_calf_raises', sets: 3, repMin: 12, repMax: 15, type: 'accessory' },
        ],
      },
      {
        name: 'Upper A',
        tags: ['upper'],
        exercises: [
          { catalogId: 'cat_db_incline_bench', sets: 4, repMin: 8, repMax: 10, type: 'primary' },
          { catalogId: 'cat_seated_row', sets: 4, repMin: 10, repMax: 12, type: 'primary' },
          { catalogId: 'cat_seated_db_ohp', sets: 3, repMin: 8, repMax: 10, type: 'accessory' },
          { catalogId: 'cat_hammer_pulldown', sets: 3, repMin: 10, repMax: 12, type: 'accessory' },
          { catalogId: 'cat_db_laterals', sets: 3, repMin: 12, repMax: 15, type: 'accessory' },
          { catalogId: 'cat_pushdowns', sets: 3, repMin: 12, repMax: 15, type: 'accessory' },
          { catalogId: 'cat_half_side_plank', sets: 3, repMin: 45, repMax: 45, type: 'accessory' },
        ],
      },
      {
        name: 'Lower B',
        tags: ['lower', 'legs'],
        exercises: [
          { catalogId: 'cat_barbell_deadlift', sets: 4, repMin: 6, repMax: 8, type: 'primary' },
          { catalogId: 'cat_leg_extension', sets: 3, repMin: 12, repMax: 15, type: 'primary' },
          { catalogId: 'cat_seated_db_good_morning', sets: 3, repMin: 10, repMax: 12, type: 'accessory' },
          { catalogId: 'cat_leg_curl', sets: 3, repMin: 10, repMax: 12, type: 'accessory' },
          { catalogId: 'cat_single_leg_raises', sets: 3, repMin: 12, repMax: 15, type: 'accessory' },
          { catalogId: 'cat_calf_raises', sets: 3, repMin: 12, repMax: 15, type: 'accessory' },
        ],
      },
      {
        name: 'Upper B',
        tags: ['upper'],
        exercises: [
          { catalogId: 'cat_unilateral_pulldown', sets: 4, repMin: 8, repMax: 10, type: 'primary' },
          { catalogId: 'cat_db_flat_bench', sets: 4, repMin: 8, repMax: 10, type: 'primary' },
          { catalogId: 'cat_straight_arm_pulldown', sets: 3, repMin: 10, repMax: 12, type: 'accessory' },
          { catalogId: 'cat_machine_reverse_fly', sets: 3, repMin: 12, repMax: 15, type: 'accessory' },
          { catalogId: 'cat_db_curls', sets: 3, repMin: 10, repMax: 12, type: 'accessory' },
          { catalogId: 'cat_farmers_walk', sets: 3, repMin: 1, repMax: 1, type: 'accessory' },
        ],
      },
    ],
    rotation: [0, 1, 'rest', 2, 3, 'rest', 'rest'],
  },
  {
    id: 'ppl_6',
    name: 'Push / Pull / Legs 6-day',
    description: 'The classic high-frequency split: each day twice a week, one rest day.',
    days: [copyDay(PUSH_DAY), copyDay(PULL_DAY), copyDay(LEGS_DAY)],
    rotation: [0, 1, 2, 0, 1, 2, 'rest'],
  },
  {
    id: 'ppl_3',
    name: 'Push / Pull / Legs 3-day',
    description: 'The same three days once a week, with a rest day between each.',
    days: [copyDay(PUSH_DAY), copyDay(PULL_DAY), copyDay(LEGS_DAY)],
    rotation: [0, 'rest', 1, 'rest', 2, 'rest', 'rest'],
  },
  {
    id: 'full_body_3',
    name: 'Full body 3-day',
    description: 'Three whole-body sessions a week — the most forgiving schedule there is.',
    days: [
      {
        name: 'Full body A',
        tags: ['upper', 'lower', 'push', 'pull', 'legs'],
        exercises: [
          { catalogId: 'cat_back_squat', sets: 3, repMin: 6, repMax: 8, type: 'primary' },
          { catalogId: 'cat_barbell_bench_press', sets: 3, repMin: 6, repMax: 8, type: 'primary' },
          { catalogId: 'cat_barbell_row', sets: 3, repMin: 8, repMax: 10, type: 'primary' },
          { catalogId: 'cat_seated_db_ohp', sets: 3, repMin: 8, repMax: 10, type: 'accessory' },
          { catalogId: 'cat_leg_curl', sets: 3, repMin: 10, repMax: 15, type: 'accessory' },
        ],
      },
      {
        name: 'Full body B',
        tags: ['upper', 'lower', 'push', 'pull', 'legs'],
        exercises: [
          { catalogId: 'cat_barbell_deadlift', sets: 3, repMin: 6, repMax: 8, type: 'primary' },
          { catalogId: 'cat_barbell_incline_bench', sets: 3, repMin: 6, repMax: 10, type: 'primary' },
          { catalogId: 'cat_lat_pulldown', sets: 3, repMin: 8, repMax: 10, type: 'primary' },
          { catalogId: 'cat_leg_press', sets: 3, repMin: 10, repMax: 12, type: 'accessory' },
          { catalogId: 'cat_db_laterals', sets: 3, repMin: 12, repMax: 15, type: 'accessory' },
        ],
      },
      {
        name: 'Full body C',
        tags: ['upper', 'lower', 'push', 'pull', 'legs'],
        exercises: [
          { catalogId: 'cat_front_squat', sets: 3, repMin: 6, repMax: 10, type: 'primary' },
          { catalogId: 'cat_dips', sets: 3, repMin: 8, repMax: 10, type: 'primary' },
          { catalogId: 'cat_chin_up', sets: 3, repMin: 6, repMax: 10, type: 'primary' },
          { catalogId: 'cat_romanian_deadlift', sets: 3, repMin: 8, repMax: 10, type: 'accessory' },
          { catalogId: 'cat_db_curls', sets: 3, repMin: 10, repMax: 15, type: 'accessory' },
          { catalogId: 'cat_pushdowns', sets: 3, repMin: 10, repMax: 15, type: 'accessory' },
        ],
      },
    ],
    rotation: [0, 'rest', 1, 'rest', 2, 'rest', 'rest'],
  },
  {
    id: 'body_part_5',
    name: 'Body part 5-day',
    description: 'One muscle group a day, five days on, two off. The old-school bodybuilder week.',
    days: [
      {
        name: 'Chest',
        tags: ['upper', 'push', 'chest'],
        exercises: [
          { catalogId: 'cat_barbell_bench_press', sets: 4, repMin: 6, repMax: 8, type: 'primary' },
          { catalogId: 'cat_barbell_incline_bench', sets: 3, repMin: 8, repMax: 10, type: 'primary' },
          { catalogId: 'cat_db_flat_bench', sets: 3, repMin: 8, repMax: 10, type: 'accessory' },
          { catalogId: 'cat_dips', sets: 3, repMin: 8, repMax: 10, type: 'accessory' },
          { catalogId: 'cat_cable_fly', sets: 3, repMin: 12, repMax: 15, type: 'accessory' },
        ],
      },
      {
        name: 'Back',
        tags: ['upper', 'pull', 'back'],
        exercises: [
          { catalogId: 'cat_barbell_row', sets: 4, repMin: 6, repMax: 8, type: 'primary' },
          { catalogId: 'cat_pull_up', sets: 3, repMin: 6, repMax: 10, type: 'primary' },
          { catalogId: 'cat_lat_pulldown', sets: 3, repMin: 8, repMax: 10, type: 'accessory' },
          { catalogId: 'cat_seated_row', sets: 3, repMin: 10, repMax: 12, type: 'accessory' },
          { catalogId: 'cat_straight_arm_pulldown', sets: 3, repMin: 12, repMax: 15, type: 'accessory' },
        ],
      },
      {
        name: 'Legs',
        tags: ['lower', 'legs'],
        exercises: [
          { catalogId: 'cat_back_squat', sets: 4, repMin: 6, repMax: 8, type: 'primary' },
          { catalogId: 'cat_romanian_deadlift', sets: 3, repMin: 8, repMax: 10, type: 'primary' },
          { catalogId: 'cat_leg_press', sets: 3, repMin: 10, repMax: 12, type: 'accessory' },
          { catalogId: 'cat_leg_extension', sets: 3, repMin: 12, repMax: 15, type: 'accessory' },
          { catalogId: 'cat_leg_curl', sets: 3, repMin: 12, repMax: 15, type: 'accessory' },
          { catalogId: 'cat_calf_raises', sets: 4, repMin: 10, repMax: 15, type: 'accessory' },
        ],
      },
      {
        name: 'Shoulders',
        tags: ['upper', 'push', 'shoulders'],
        exercises: [
          { catalogId: 'cat_seated_db_ohp', sets: 4, repMin: 8, repMax: 10, type: 'primary' },
          { catalogId: 'cat_db_laterals', sets: 4, repMin: 12, repMax: 15, type: 'accessory' },
          { catalogId: 'cat_cable_lateral_raise', sets: 3, repMin: 12, repMax: 15, type: 'accessory' },
          { catalogId: 'cat_machine_reverse_fly', sets: 3, repMin: 12, repMax: 15, type: 'accessory' },
          { catalogId: 'cat_face_pull', sets: 3, repMin: 12, repMax: 15, type: 'accessory' },
        ],
      },
      {
        name: 'Arms',
        tags: ['upper', 'push', 'pull', 'arms'],
        exercises: [
          { catalogId: 'cat_chin_up', sets: 3, repMin: 6, repMax: 10, type: 'primary' },
          { catalogId: 'cat_skull_crushers', sets: 3, repMin: 8, repMax: 10, type: 'primary' },
          { catalogId: 'cat_incline_db_curl', sets: 3, repMin: 10, repMax: 12, type: 'accessory' },
          { catalogId: 'cat_pushdowns', sets: 3, repMin: 12, repMax: 15, type: 'accessory' },
          { catalogId: 'cat_db_curls', sets: 3, repMin: 10, repMax: 15, type: 'accessory' },
        ],
      },
    ],
    rotation: [0, 1, 2, 3, 4, 'rest', 'rest'],
  },
];

/** One preset by id, or `undefined`. */
export function getPreset(id: string): ProgrammePreset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}
