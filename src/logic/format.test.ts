import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatLastSession,
  formatLoad,
  formatNumber,
  formatPrescription,
  formatRepTarget,
  formatSetSummary,
} from './format';
import { makeExercise, makeSets } from './testFixtures';

describe('formatNumber / formatDuration', () => {
  it('drops trailing zeros', () => {
    expect(formatNumber(70)).toBe('70');
    expect(formatNumber(2.5)).toBe('2.5');
    expect(formatNumber(32.5)).toBe('32.5');
  });

  it('formats times', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(252)).toBe('4:12');
    expect(formatDuration(600)).toBe('10:00');
  });
});

describe('formatLoad', () => {
  it('adds the right suffix per unit', () => {
    expect(formatLoad(makeExercise({ unit: 'kg_side' }), 30)).toBe('30 kg/hand');
    expect(formatLoad(makeExercise({ unit: 'kg_total' }), 70)).toBe('70 kg');
    expect(formatLoad(makeExercise({ unit: 'band' }), 0)).toBe('band');
    expect(formatLoad(makeExercise({ unit: 'bodyweight' }), 0)).toBe('BW');
    expect(formatLoad(makeExercise({ unit: 'bodyweight' }), 10)).toBe('BW +10 kg');
    expect(formatLoad(makeExercise({ unit: 'none' }), 0)).toBe('—');
  });
});

describe('formatSetSummary', () => {
  it('collapses identical reps', () => {
    const ex = makeExercise({ sets: 4, repMin: 8, repMax: 10 });
    expect(formatSetSummary(ex, makeSets('s1', 70, [8, 8, 8, 8]))).toBe('4×8 @ 70');
  });

  it('shows a range when reps were mixed', () => {
    const ex = makeExercise({ sets: 4, repMin: 8, repMax: 10 });
    expect(formatSetSummary(ex, makeSets('s1', 70, [10, 9, 8, 8]))).toBe('4×8–10 @ 70');
  });

  it('omits the load for bodyweight and timed work', () => {
    const plank = makeExercise({
      unit: 'bodyweight',
      measure: 'seconds',
      sets: 3,
      repMin: 45,
      repMax: 45,
      perSide: true,
    });
    expect(formatSetSummary(plank, makeSets('s1', 0, [45, 45, 45]))).toBe('3×45s');
  });

  it('counts laps for the farmer’s walk', () => {
    const walk = makeExercise({
      name: "Farmer's walk",
      unit: 'kg_side',
      measure: 'laps',
      sets: 3,
      repMin: 1,
      repMax: 1,
      increment: 2.5,
      type: 'accessory',
    });
    expect(formatSetSummary(walk, makeSets('s1', 30, [1, 1, 1]))).toBe('3 laps @ 30');
  });

  it('renders a conditioning row as distance + time', () => {
    const row = makeExercise({
      name: 'Row 1 km',
      type: 'conditioning',
      measure: 'seconds',
      unit: 'none',
      increment: 0,
      sets: 1,
      repMin: 0,
      repMax: 0,
    });
    expect(formatSetSummary(row, makeSets('s1', 0, [252]))).toBe('1 km in 4:12');
  });

  it('returns a dash for no sets', () => {
    expect(formatSetSummary(makeExercise(), [])).toBe('—');
    expect(formatLastSession(makeExercise(), undefined)).toBe('last: —');
    expect(formatLastSession(makeExercise(), makeSets('s1', 70, [8, 8, 8, 8]))).toBe(
      'last: 4×8 @ 70',
    );
  });
});

describe('formatRepTarget / formatPrescription', () => {
  it('formats ranges, fixed reps and times', () => {
    expect(formatRepTarget(makeExercise({ repMin: 8, repMax: 10 }))).toBe('8–10');
    expect(formatRepTarget(makeExercise({ repMin: 12, repMax: 12 }))).toBe('12');
    expect(
      formatRepTarget(makeExercise({ repMin: 45, repMax: 45, measure: 'seconds' })),
    ).toBe('45s');
  });

  it('marks per-side work with "each"', () => {
    expect(
      formatPrescription(makeExercise({ sets: 3, repMin: 15, repMax: 15, perSide: true })),
    ).toBe('3 × 15 each');
    expect(formatPrescription(makeExercise({ sets: 4, repMin: 8, repMax: 10 }))).toBe(
      '4 × 8–10',
    );
    expect(
      formatPrescription(
        makeExercise({ sets: 3, measure: 'laps', repMin: 1, repMax: 1 }),
      ),
    ).toBe('3 laps');
  });
});
