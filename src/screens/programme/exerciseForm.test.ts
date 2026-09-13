import { describe, expect, it } from 'vitest';
import { makeExercise } from '../../logic/testFixtures';
import {
  blankDraft,
  changeMassUnit,
  coerceScheme,
  schemeOptionsFor,
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

describe('progression scheme on the draft', () => {
  it('starts a new exercise on double progression', () => {
    expect(blankDraft().scheme).toBe('double');
  });

  it('reads the default for the type when the row names none', () => {
    expect(draftFromExercise(makeExercise({ type: 'primary' })).scheme).toBe('double');
    expect(draftFromExercise(makeExercise({ type: 'conditioning' })).scheme).toBe('best-time');
  });

  it('round-trips a stored scheme', () => {
    const draft = draftFromExercise(makeExercise({ scheme: 'linear' }));
    expect(draft.scheme).toBe('linear');
    expect(draftToInput(draft, 'lowerA').scheme).toBe('linear');
  });

  it('offers best time only to conditioning, and no load schemes there', () => {
    expect(schemeOptionsFor('primary').map((o) => o.value)).toEqual([
      'double',
      'linear',
      'none',
    ]);
    expect(schemeOptionsFor('conditioning').map((o) => o.value)).toEqual(['none', 'best-time']);
  });

  it('keeps the scheme legal when the type changes under it', () => {
    expect(coerceScheme('double', 'conditioning')).toBe('best-time');
    expect(coerceScheme('linear', 'conditioning')).toBe('best-time');
    expect(coerceScheme('none', 'conditioning')).toBe('none');
    expect(coerceScheme('best-time', 'primary')).toBe('double');
    expect(coerceScheme('linear', 'primary')).toBe('linear');
  });

  it('saves a legal scheme even if the draft went stale', () => {
    const draft: ExerciseDraft = { ...blankDraft(), scheme: 'best-time', type: 'accessory' };
    expect(draftToInput(draft, 'lowerA').scheme).toBe('double');
  });
});

describe('rest override and note on the draft', () => {
  it('reads an empty rest and note off a plain exercise', () => {
    const draft = draftFromExercise(makeExercise());
    expect(draft.restOverride).toBeNull();
    expect(draft.note).toBe('');
  });

  it('round-trips both', () => {
    const draft = draftFromExercise(
      makeExercise({ restOverride: 45, note: 'Seat 4, handles narrow' }),
    );
    expect(draft).toMatchObject({ restOverride: 45, note: 'Seat 4, handles narrow' });
    expect(draftToInput(draft, 'lowerA')).toMatchObject({
      restOverride: 45,
      note: 'Seat 4, handles narrow',
    });
  });

  it('clears them explicitly, so a saved row loses what it had', () => {
    const draft: ExerciseDraft = { ...blankDraft(), restOverride: null, note: '   ' };
    const input = draftToInput(draft, 'lowerA');
    expect(input.restOverride).toBeUndefined();
    expect(input.note).toBeUndefined();
    expect('restOverride' in input).toBe(true);
    expect('note' in input).toBe(true);
  });

  it('treats a zero rest as "use the default"', () => {
    const draft: ExerciseDraft = { ...blankDraft(), restOverride: 0 };
    expect(draftToInput(draft, 'lowerA').restOverride).toBeUndefined();
  });

  it('rounds a rest to whole seconds and trims the note', () => {
    const draft: ExerciseDraft = { ...blankDraft(), restOverride: 45.4, note: '  Seat 4  ' };
    expect(draftToInput(draft, 'lowerA')).toMatchObject({ restOverride: 45, note: 'Seat 4' });
  });
});
