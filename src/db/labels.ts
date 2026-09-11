/**
 * Display strings for the catalogue vocabularies. Kept next to the types (and
 * away from the screens) so every picker, chip and chart spells a muscle,
 * equipment, pattern or split tag the same way.
 */
import type { Equipment, Muscle, Pattern, SplitTag, SplitTagGroup } from './types';

export const MUSCLE_LABELS: Record<Muscle, string> = {
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  adductors: 'Adductors',
  abductors: 'Abductors',
  calves: 'Calves',
  chest: 'Chest',
  lats: 'Lats',
  upper_back: 'Upper back',
  front_delts: 'Front delts',
  side_delts: 'Side delts',
  rear_delts: 'Rear delts',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  core: 'Core',
  lower_back: 'Lower back',
};

export const EQUIPMENT_LABELS: Record<Equipment, string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  machine: 'Machine',
  cable: 'Cable',
  band: 'Band',
  bodyweight: 'Bodyweight',
  kettlebell: 'Kettlebell',
  other: 'Other',
};

export const PATTERN_LABELS: Record<Pattern, string> = {
  squat: 'Squat',
  hinge: 'Hinge',
  lunge: 'Lunge',
  horizontal_push: 'Horizontal push',
  vertical_push: 'Vertical push',
  horizontal_pull: 'Horizontal pull',
  vertical_pull: 'Vertical pull',
  carry: 'Carry',
  isolation: 'Isolation',
  core: 'Core',
  conditioning: 'Conditioning',
};

export const SPLIT_TAG_LABELS: Record<SplitTag, string> = {
  upper: 'Upper',
  lower: 'Lower',
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  arms: 'Arms',
  core: 'Core',
  cardio: 'Cardio',
};

/** Section headings for the grouped tag filter in `SPLIT_TAGS` order. */
export const SPLIT_TAG_GROUP_LABELS: Record<SplitTagGroup, string> = {
  upperLower: 'Upper / lower',
  ppl: 'Push / pull / legs',
  bodyPart: 'Body part',
  other: 'Other',
};
