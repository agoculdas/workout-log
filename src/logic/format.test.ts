import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatLastSession,
  formatLoad,
  formatMassUnit,
  formatNumber,
  formatPrescription,
  formatRepTarget,
  formatSetSummary,
  formatVolumeKg,
} from './format';
import { makeExercise, makeSets, makeWarmup } from './testFixtures';

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
    expect(formatSetSummary(ex, makeSets('s1', 70, [8, 8, 8, 8]))).toBe('4×8 @ 70 kg');
  });

  it('shows a range when reps were mixed', () => {
    const ex = makeExercise({ sets: 4, repMin: 8, repMax: 10 });
    expect(formatSetSummary(ex, makeSets('s1', 70, [10, 9, 8, 8]))).toBe('4×8–10 @ 70 kg');
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
    expect(formatSetSummary(walk, makeSets('s1', 30, [1, 1, 1]))).toBe('3 laps @ 30 kg');
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
      'last: 4×8 @ 70 kg',
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

describe('pounds', () => {
  it('formatLoad prints the exercise denomination', () => {
    expect(formatLoad(makeExercise({ unit: 'kg_side', massUnit: 'lb' }), 30)).toBe(
      '30 lb/hand',
    );
    expect(formatLoad(makeExercise({ unit: 'kg_total', massUnit: 'lb' }), 70)).toBe('70 lb');
    expect(formatLoad(makeExercise({ unit: 'kg_total', massUnit: 'kg' }), 70)).toBe('70 kg');
    expect(
      formatLoad(makeExercise({ unit: 'bodyweight', massUnit: 'lb', increment: 0 }), 10),
    ).toBe('BW +10 lb');
  });

  it('formatSetSummary and formatLastSession print it too', () => {
    const lb = makeExercise({ unit: 'kg_side', massUnit: 'lb', sets: 3, repMin: 10, repMax: 10 });
    const sets = makeSets('s1', 30, [10, 10, 10], { massUnit: 'lb' });
    expect(formatSetSummary(lb, sets)).toBe('3×10 @ 30 lb');
    expect(formatLastSession(lb, sets)).toBe('last: 3×10 @ 30 lb');
  });

  it('formatMassUnit gives the suffix a load field shows', () => {
    expect(formatMassUnit(makeExercise({ unit: 'kg_total' }))).toBe('kg');
    expect(formatMassUnit(makeExercise({ unit: 'kg_total', massUnit: 'lb' }))).toBe('lb');
    expect(formatMassUnit(makeExercise({ unit: 'kg_side' }))).toBe('kg/hand');
    expect(formatMassUnit(makeExercise({ unit: 'kg_side', massUnit: 'lb' }))).toBe('lb/hand');
    expect(formatMassUnit(makeExercise({ unit: 'band' }))).toBe('band');
    expect(formatMassUnit(makeExercise({ unit: 'bodyweight' }))).toBe('BW');
    expect(formatMassUnit(makeExercise({ unit: 'none' }))).toBe('—');
  });

  it('bands keep a bare number', () => {
    const band = makeExercise({ unit: 'band', increment: 0, sets: 3, repMin: 25, repMax: 25 });
    expect(formatSetSummary(band, makeSets('s1', 5, [25, 25, 25]))).toBe('3×25 @ 5');
  });
});

describe('formatVolumeKg', () => {
  it('rounds and groups thousands', () => {
    expect(formatVolumeKg(1240)).toBe('1,240 kg');
    expect(formatVolumeKg(1239.6)).toBe('1,240 kg');
    expect(formatVolumeKg(0)).toBe('0 kg');
    expect(formatVolumeKg(12345678)).toBe('12,345,678 kg');
  });
});

describe('format — warm-ups', () => {
  it('are left out of the summary and the last-session line', () => {
    const ex = makeExercise({ sets: 4, repMin: 8, repMax: 10 });
    const withWarmup = [makeWarmup('s1', 200, 20), ...makeSets('s1', 70, [8, 8, 8, 8])];
    expect(formatSetSummary(ex, withWarmup)).toBe('4×8 @ 70 kg');
    expect(formatLastSession(ex, withWarmup)).toBe('last: 4×8 @ 70 kg');
  });

  it('a warm-up-only exercise reads as nothing logged', () => {
    const only = [makeWarmup('s1', 40, 10)];
    expect(formatSetSummary(makeExercise(), only)).toBe('—');
    expect(formatLastSession(makeExercise(), only)).toBe('last: —');
  });
});
