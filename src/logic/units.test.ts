import { describe, expect, it } from 'vitest';
import { KG_PER_LB } from '../db/types';
import {
  defaultIncrement,
  exerciseMassUnit,
  fromKg,
  massLabel,
  roundToStep,
  setMassUnit,
  toKg,
} from './units';
import { makeExercise, makeSets } from './testFixtures';

describe('toKg / fromKg', () => {
  it('leaves kilograms alone', () => {
    expect(toKg(70, 'kg')).toBe(70);
    expect(fromKg(70, 'kg')).toBe(70);
  });

  it('converts pounds', () => {
    expect(toKg(100, 'lb')).toBeCloseTo(45.359237, 6);
    expect(toKg(1, 'lb')).toBe(KG_PER_LB);
    expect(fromKg(45.359237, 'lb')).toBeCloseTo(100, 6);
  });

  it('round-trips', () => {
    for (const value of [0, 2.5, 45, 70.5, 315]) {
      expect(fromKg(toKg(value, 'lb'), 'lb')).toBeCloseTo(value, 9);
      expect(toKg(fromKg(value, 'lb'), 'lb')).toBeCloseTo(value, 9);
    }
  });

  it('labels the unit', () => {
    expect(massLabel('kg')).toBe('kg');
    expect(massLabel('lb')).toBe('lb');
  });
});

describe('exerciseMassUnit / setMassUnit', () => {
  it('treats an absent denomination as kg', () => {
    expect(exerciseMassUnit(makeExercise())).toBe('kg');
    expect(exerciseMassUnit(makeExercise({ massUnit: 'lb' }))).toBe('lb');
    expect(exerciseMassUnit(undefined)).toBe('kg');
    expect(setMassUnit(makeSets('s1', 70, [10])[0])).toBe('kg');
    expect(setMassUnit(makeSets('s1', 70, [10], { massUnit: 'lb' })[0])).toBe('lb');
    expect(setMassUnit(undefined)).toBe('kg');
  });
});

describe('defaultIncrement', () => {
  it('is 2.5 in kg, 5 in lb, and 0 where there is nothing to load', () => {
    const table: Array<[Parameters<typeof defaultIncrement>[0], 'kg' | 'lb', number]> = [
      ['kg_side', 'kg', 2.5],
      ['kg_total', 'kg', 2.5],
      ['kg_side', 'lb', 5],
      ['kg_total', 'lb', 5],
      ['band', 'kg', 0],
      ['band', 'lb', 0],
      ['bodyweight', 'kg', 0],
      ['bodyweight', 'lb', 0],
      ['none', 'kg', 0],
      ['none', 'lb', 0],
    ];
    for (const [unit, mass, expected] of table) {
      expect(defaultIncrement(unit, mass)).toBe(expected);
    }
  });
});

describe('roundToStep', () => {
  it('snaps to the nearest multiple', () => {
    expect(roundToStep(71.2, 2.5)).toBe(70);
    expect(roundToStep(71.3, 2.5)).toBe(72.5);
    expect(roundToStep(7.05, 0.1)).toBe(7.1);
    expect(roundToStep(42, 0)).toBe(42);
    expect(roundToStep(42, -1)).toBe(42);
  });

  it('leaves no float dust', () => {
    expect(String(roundToStep(7.0001, 0.1))).toBe('7');
  });
});
