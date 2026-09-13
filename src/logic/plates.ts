/**
 * Plate maths for barbell lifts. Everything here is in kilograms — the caller
 * converts first when the exercise is denominated in pounds.
 */

export interface PlateBreakdown {
  /** Plates for ONE side, heaviest first, with repeats. */
  perSide: number[];
  /** What `perSide` actually adds up to, including the bar. */
  total: number;
  /** Target minus `total`: what could not be loaded. Never negative. */
  remainder: number;
  /** The bar this was worked out against. */
  bar: number;
}

/** Floating-point slack: plate sizes are 1.25 kg at the smallest. */
const EPS = 1e-9;

/**
 * Greedy breakdown from the heaviest plate down. An unreachable target leaves
 * the shortfall in `remainder` rather than overshooting, and a target at or
 * below the bar loads nothing at all.
 */
export function platesPerSide(
  targetTotal: number,
  bar: number,
  plates: number[],
): PlateBreakdown {
  const safeBar = Number.isFinite(bar) && bar > 0 ? bar : 0;
  const target = Number.isFinite(targetTotal) ? targetTotal : 0;

  if (target < safeBar + EPS) {
    return { perSide: [], total: safeBar, remainder: 0, bar: safeBar };
  }

  const sizes = [...new Set(plates.filter((p) => Number.isFinite(p) && p > 0))].sort(
    (a, b) => b - a,
  );

  let remainingPerSide = (target - safeBar) / 2;
  const perSide: number[] = [];
  for (const plate of sizes) {
    const count = Math.floor((remainingPerSide + EPS) / plate);
    for (let i = 0; i < count; i++) perSide.push(plate);
    remainingPerSide -= count * plate;
    if (remainingPerSide < EPS) break;
  }

  const loaded = perSide.reduce((sum, p) => sum + p, 0);
  const total = Number((safeBar + loaded * 2).toFixed(6));
  const remainder = Math.max(0, Number((target - total).toFixed(6)));
  return { perSide, total, remainder, bar: safeBar };
}
