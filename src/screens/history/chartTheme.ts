/** Mirrors the `@theme` tokens in src/index.css — Recharts needs real values. */
export const CHART_COLORS = {
  accent: '#a3e635',
  accentStrong: '#84cc16',
  muted: '#a1a1aa',
  border: '#3f3f46',
  surface: '#18181b',
  fg: '#fafafa',
} as const;

export const AXIS_STYLE = {
  stroke: CHART_COLORS.border,
  tick: { fill: CHART_COLORS.muted, fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

export const TOOLTIP_STYLE = {
  background: CHART_COLORS.surface,
  border: `1px solid ${CHART_COLORS.border}`,
  borderRadius: 12,
  padding: '6px 10px',
  fontSize: 12,
  color: CHART_COLORS.fg,
} as const;
