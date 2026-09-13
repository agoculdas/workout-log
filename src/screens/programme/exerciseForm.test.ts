import { describe, expect, it } from 'vitest';
import { makeExercise } from '../../logic/testFixtures';
import {
  blankDraft,
  changeMassUnit,
  draftFromExercise,
  draftToInput,
  hasDenomination,
  incrementLabel,
  unitLabel,
  type ExerciseDraft,
} from './exerciseForm';

describe('unit labels', () => {
  it('spells the load unit in the exercise denomination', () => {
    expect(unitLabel('kg_total', 'kg')).toBe('kg');
    expect(unitLabel('kg_total', 'lb')).toBe('lb');
    expect(unitLabel('kg_side', 'kg')).toBe('kg/hand');
    expect(unitLabel('kg_side', 'lb')).toBe('lb/hand');
  });

  it('treats a missing denomination as kilograms', () => {
    expect(unitLabel('kg_side')).toBe('kg/hand');
  });

  it('leaves the unloaded units alone whatever the denomination', () => {
    expect(unitLabel('band', 'lb')).toBe('band');
    expect(unitLabel('bodyweight', 'lb')).toBe('BW');
    expect(unitLabel('none', 'lb')).toBe('—');
  });

  it('only offers a denomination for units that carry weight', () => {
    expect(hasDenomination('kg_side')).toBe(true);
    expect(hasDenomination('kg_total')).toBe(true);
    expect(hasDenomination('band')).toBe(false);
    expect(hasDenomination('bodyweight')).toBe(false);
  });

  it('prints the increment in the exercise denomination', () => {
    expect(incrementLabel(makeExercise({ increment: 2.5 }))).toBe('+2.5 kg');
    expect(incrementLabel(makeExercise({ increment: 5, massUnit: 'lb' }))).toBe('+5 lb');
    expect(incrementLabel(makeExercise({ unit: 'bodyweight', increment: 0 }))).toBe('—');
  });
});

describe('denomination on the draft', () => {
  it('starts a new exercise in the denomination Settings names', () => {
    expect(blankDraft('lb')).toMatchObject({ massUnit: 'lb', increment: 5 });
    expect(blankDraft('kg')).toMatchObject({ massUnit: 'kg', increment: 2.5 });
    expect(blankDraft().massUnit).toBe('kg');
  });

  it('keeps an existing row in its own denomination', () => {
    expect(draftFromExercise(makeExercise({ massUnit: 'lb' })).massUnit).toBe('lb');
    expect(draftFromExercise(makeExercise()).massUnit).toBe('kg');
  });

  it('carries the denomination into the stored row', () => {
    const draft = { ...blankDraft('lb'), name: 'Chest press' };
    expect(draftToInput(draft, 'upperA')).toMatchObject({ massUnit: 'lb', increment: 5 });
  });
});

describe('switching denomination', () => {
  const draft: ExerciseDraft = blankDraft('kg');

  it('takes the new denomination default increment', () => {
    expect(changeMassUnit(draft, 'lb', false)).toEqual({ massUnit: 'lb', increment: 5 });
    expect(changeMassUnit({ ...draft, massUnit: 'lb', increment: 5 }, 'kg', false)).toEqual({
      massUnit: 'kg',
      increment: 2.5,
    });
  });

  it('leaves an increment the user typed alone', () => {
    expect(changeMassUnit({ ...draft, increment: 1.25 }, 'lb', true)).toEqual({
      massUnit: 'lb',
    });
  });

  it('does nothing when the denomination has not changed', () => {
    expect(changeMassUnit(draft, 'kg', false)).toEqual({});
  });

  it('has no increment to convert on a band', () => {
    expect(changeMassUnit({ ...draft, unit: 'band', increment: 0 }, 'lb', false)).toEqual({
      massUnit: 'lb',
    });
  });
});
