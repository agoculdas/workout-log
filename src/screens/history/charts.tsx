/**
 * The Recharts wrappers used by the history screens. Kept apart from the
 * screens so the data-shaping helpers (`series.ts`, `bodyweightStats.ts`) stay
 * importable — and unit-testable — without pulling a chart library in.
 */
import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatDate } from '../../logic/format';
import { AXIS_STYLE, CHART_COLORS, TOOLTIP_STYLE } from './chartTheme';
import type { BodyweightPoint } from './bodyweightStats';
import { formatKg } from './bodyweightStats';
import { formatPerWeek, type MuscleBarRow, type WeekPoint } from './muscleSeries';
import { hasTrend, paddedDomain, type SeriesPoint } from './series';

function Tip({ title, value }: { title: string; value: string }) {
  return (
    <div style={TOOLTIP_STYLE}>
      <div style={{ color: CHART_COLORS.muted }}>{title}</div>
      <div style={{ fontWeight: 600 }}>{value}</div>
    </div>
  );
}

interface FrameProps {
  title: string;
  aside?: ReactNode;
  height: number;
  children: ReactNode;
}

/**
 * Titled box with a fixed pixel height. ResponsiveContainer measures its
 * parent, so the parent must not be an auto-height flex child — hence the
 * explicit height and `min-w-0` here rather than on the caller.
 */
function ChartFrame({ title, aside, height, children }: FrameProps) {
  return (
    <section className="min-w-0 rounded-2xl border border-border/70 bg-surface p-3">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium tracking-wide text-muted uppercase">{title}</h3>
        {aside ? <span className="text-xs text-muted">{aside}</span> : null}
      </div>
      <div className="min-w-0" style={{ height }}>
        {children}
      </div>
    </section>
  );
}

export interface TrendChartProps {
  title: string;
  data: SeriesPoint[];
  /** Formats the y value in the tooltip and on the axis. */
  formatValue?: (value: number) => string;
  color?: string;
  height?: number;
  /** Shown to the right of the title, e.g. the latest value. */
  aside?: ReactNode;
  /** Extra line under the "not enough data" message. */
  emptyHint?: string;
}

/** One line over session dates. Falls back to a hint below two data points. */
export function TrendChart({
  title,
  data,
  formatValue = (v) => String(v),
  color = CHART_COLORS.accent,
  height = 180,
  aside,
  emptyHint,
}: TrendChartProps) {
  if (!hasTrend(data)) {
    const only = data[0];
    return (
      <ChartFrame title={title} aside={aside} height={64}>
        <div className="flex h-full flex-col justify-center text-sm text-muted">
          <p>
            {only
              ? `One session so far — ${only.label}: ${formatValue(only.value)}.`
              : 'Nothing logged yet.'}
          </p>
          <p className="text-xs">{emptyHint ?? 'The chart appears after two sessions.'}</p>
        </div>
      </ChartFrame>
    );
  }

  const domain = paddedDomain(data);
  const first = data[0]!;
  const last = data[data.length - 1]!;

  return (
    <ChartFrame title={title} aside={aside} height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: -14 }}>
          <CartesianGrid stroke={CHART_COLORS.border} strokeOpacity={0.4} vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            ticks={[first.t, last.t]}
            tickFormatter={(value: number) => formatDate(value)}
            {...AXIS_STYLE}
          />
          <YAxis
            width={52}
            domain={domain ?? ['auto', 'auto']}
            // Reps and seconds are whole numbers; "40.5 reps" is not a tick.
            allowDecimals={data.some((p) => !Number.isInteger(p.value))}
            tickFormatter={(value: number) => formatValue(value)}
            {...AXIS_STYLE}
          />
          <Tooltip
            cursor={{ stroke: CHART_COLORS.border }}
            content={(props) => {
              const point = props.payload?.[0]?.payload as SeriesPoint | undefined;
              if (!props.active || !point) return null;
              return <Tip title={point.label} value={formatValue(point.value)} />;
            }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={{ r: 2.5, fill: color, stroke: color }}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export interface BodyweightChartProps {
  data: BodyweightPoint[];
  height?: number;
  aside?: ReactNode;
}

/** Daily readings (dots) with the 7-day rolling average over the top. */
export function BodyweightChart({ data, height = 200, aside }: BodyweightChartProps) {
  if (data.length < 2) {
    return (
      <ChartFrame title="Weight" aside={aside} height={64}>
        <div className="flex h-full flex-col justify-center text-sm text-muted">
          <p>
            {data[0]
              ? `One reading so far — ${formatKg(data[0].kg)} kg.`
              : 'No weigh-ins yet.'}
          </p>
          <p className="text-xs">Add a couple of days to see the trend.</p>
        </div>
      </ChartFrame>
    );
  }

  const weights = data.map((p) => p.kg);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const pad = Math.max((max - min) * 0.1, 0.3);

  return (
    <ChartFrame title="Weight" aside={aside} height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: -14 }}>
          <CartesianGrid stroke={CHART_COLORS.border} strokeOpacity={0.4} vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            ticks={[data[0]!.t, data[data.length - 1]!.t]}
            tickFormatter={(value: number) => formatDate(value)}
            {...AXIS_STYLE}
          />
          <YAxis
            width={52}
            domain={[min - pad, max + pad]}
            tickFormatter={(value: number) => formatKg(value)}
            {...AXIS_STYLE}
          />
          <Tooltip
            cursor={{ stroke: CHART_COLORS.border }}
            content={(props) => {
              const point = props.payload?.[0]?.payload as BodyweightPoint | undefined;
              if (!props.active || !point) return null;
              return (
                <Tip
                  title={formatDate(point.t)}
                  value={`${formatKg(point.kg)} kg · avg ${formatKg(point.avg)}`}
                />
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="kg"
            stroke={CHART_COLORS.muted}
            strokeWidth={1}
            strokeOpacity={0.7}
            dot={{ r: 2, fill: CHART_COLORS.muted, stroke: CHART_COLORS.muted }}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="avg"
            stroke={CHART_COLORS.accent}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export interface MuscleBarsChartProps {
  /** Already sorted and filtered by `perWeekRows` / `splitByVolume`. */
  data: MuscleBarRow[];
  title?: string;
  aside?: ReactNode;
}

/**
 * Sets per week per muscle as horizontal bars — a vertical Recharts layout,
 * so the muscle names read left to right on a phone. The frame grows with the
 * number of bars rather than squashing them.
 */
export function MuscleBarsChart({
  data,
  title = 'Sets per week',
  aside,
}: MuscleBarsChartProps) {
  if (!data.length) {
    return (
      <ChartFrame title={title} aside={aside} height={64}>
        <div className="flex h-full items-center text-sm text-muted">
          Nothing was linked to a muscle in this window.
        </div>
      </ChartFrame>
    );
  }

  const max = Math.max(...data.map((row) => row.perWeek));

  return (
    <ChartFrame title={title} aside={aside} height={data.length * 24 + 12}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 2, right: 34, bottom: 2, left: 0 }}
          barCategoryGap="18%"
        >
          <XAxis type="number" hide domain={[0, max * 1.18]} />
          <YAxis
            type="category"
            dataKey="label"
            width={84}
            interval={0}
            {...AXIS_STYLE}
            tick={{ ...AXIS_STYLE.tick, fontSize: 11 }}
          />
          <Tooltip
            cursor={{ fill: CHART_COLORS.border, fillOpacity: 0.35 }}
            content={(props) => {
              const row = props.payload?.[0]?.payload as MuscleBarRow | undefined;
              if (!props.active || !row) return null;
              return (
                <Tip
                  title={row.label}
                  value={`${formatPerWeek(row.perWeek)} sets/week · ${row.sessions} session${
                    row.sessions === 1 ? '' : 's'
                  }`}
                />
              );
            }}
          />
          <Bar
            dataKey="perWeek"
            fill={CHART_COLORS.accent}
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="perWeek"
              position="right"
              offset={6}
              fill={CHART_COLORS.muted}
              fontSize={11}
              formatter={(value: unknown) =>
                typeof value === 'number' ? formatPerWeek(value) : ''
              }
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export interface WeekTrendChartProps {
  data: WeekPoint[];
  title?: string;
  aside?: ReactNode;
  height?: number;
}

/** Total weighted sets per week — one point per week, empty weeks included. */
export function WeekTrendChart({
  data,
  title = 'Total sets per week',
  aside,
  height = 160,
}: WeekTrendChartProps) {
  if (data.length < 2) {
    return (
      <ChartFrame title={title} aside={aside} height={64}>
        <div className="flex h-full items-center text-sm text-muted">
          Pick a longer window to see the week-by-week trend.
        </div>
      </ChartFrame>
    );
  }

  const first = data[0]!;
  const last = data[data.length - 1]!;
  const max = Math.max(...data.map((point) => point.value));

  return (
    <ChartFrame title={title} aside={aside} height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
          <CartesianGrid stroke={CHART_COLORS.border} strokeOpacity={0.4} vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            ticks={[first.t, last.t]}
            tickFormatter={(value: number) => formatDate(value)}
            {...AXIS_STYLE}
          />
          <YAxis
            width={46}
            domain={[0, Math.max(4, Math.ceil(max * 1.1))]}
            allowDecimals={false}
            {...AXIS_STYLE}
          />
          <Tooltip
            cursor={{ stroke: CHART_COLORS.border }}
            content={(props) => {
              const point = props.payload?.[0]?.payload as WeekPoint | undefined;
              if (!props.active || !point) return null;
              return (
                <Tip
                  title={`Week of ${point.label}`}
                  value={`${formatPerWeek(point.value)} sets · ${point.sessions} session${
                    point.sessions === 1 ? '' : 's'
                  }`}
                />
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={CHART_COLORS.accent}
            strokeWidth={2}
            dot={{ r: 2.5, fill: CHART_COLORS.accent, stroke: CHART_COLORS.accent }}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
