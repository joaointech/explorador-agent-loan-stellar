"use client";

import { useId, useSyncExternalStore, type ReactNode } from "react";
import {
  Area,
  AreaChart as RechartsAreaChart,
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import { cn } from "./cn";
import { Skeleton } from "./skeleton";

// Recharts wrappers in the explorador style (spec §10.1): blue-600 lines on
// light-blue fills, hairline horizontal grid only, muted axis text, a
// crosshair tooltip listing every series. Colours are CSS variables
// (--color-chart-1..3, globals.css), so charts follow the theme with no JS.
// Series slots are a fixed, CVD-validated order: at most 3 series.

export type ChartSlot = 1 | 2 | 3;

export interface ChartSeries {
  /** Key of the numeric value in each datum. */
  key: string;
  label: string;
  /** Colour slot; defaults to the series position (1, 2, 3). Keep it stable per entity. */
  slot?: ChartSlot;
}

export type ChartDatum = Record<string, unknown>;

export interface ChartProps {
  /** Rows with an x value and one numeric value per series (convert stroops to euros first). */
  data: ChartDatum[];
  /** Key of the x value (e.g. "t" unix seconds, or a label). */
  x: string;
  series: ChartSeries[];
  /** Accessible name; also captions the screen-reader data table. */
  title: string;
  /** Header of the x column in the data table. Default "Date". */
  xLabel?: string;
  /** Total height including the x-axis band. Default 240. */
  height?: number;
  formatX?: (value: unknown) => string;
  /** Y-axis ticks (keep them short: compact euros, 3-4 decimals for prices). */
  formatY?: (value: number) => string;
  /** Tooltip and table values; defaults to formatY. */
  formatValue?: (value: number) => string;
  /** Y domain, e.g. ["auto", "auto"] for prices that hover near 1.0. Default [0, "auto"]. */
  yDomain?: [number | "auto" | "dataMin" | "dataMax", number | "auto" | "dataMin" | "dataMax"];
  loading?: boolean;
  /** Shown instead of the plot when `data` is empty. */
  empty?: ReactNode;
  className?: string;
}

const SLOT_COLOR: Record<ChartSlot, string> = {
  1: "var(--color-chart-1)",
  2: "var(--color-chart-2)",
  3: "var(--color-chart-3)",
};

const colorOf = (s: ChartSeries, index: number) => SLOT_COLOR[s.slot ?? (Math.min(index, 2) + 1) as ChartSlot];

const defaultFormat = (v: unknown) => (typeof v === "number" ? new Intl.NumberFormat("en-GB").format(v) : String(v ?? ""));

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => true,
  );
}

type TooltipProps = Partial<TooltipContentProps<number, string>> & {
  formatX: (value: unknown) => string;
  formatValue: (value: number) => string;
};

/** Tooltip card: the date, then one row per series (value first, then a line key and the name). */
function ChartTooltipContent({ active, payload, label, formatX, formatValue }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-36 rounded-xl border border-line bg-card px-3 py-2 text-xs shadow-pop">
      <p className="font-medium text-muted">{formatX(label)}</p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {payload.map((entry) => (
          <li key={String(entry.dataKey)} className="flex items-center gap-2">
            <span aria-hidden className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: entry.color }} />
            <span className="font-semibold text-heading tabular-nums">
              {typeof entry.value === "number" ? formatValue(entry.value) : String(entry.value ?? "")}
            </span>
            <span className="text-muted">{entry.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Legend({ series, mark }: { series: ChartSeries[]; mark: "area" | "line" }) {
  if (series.length < 2) return null;
  return (
    <ul aria-hidden className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-muted">
      {series.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span
            className={mark === "area" ? "size-2.5 rounded-[3px]" : "h-0.5 w-3.5 rounded-full"}
            style={{ background: colorOf(s, i) }}
          />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** The same numbers as a table, for screen readers (tooltips never gate values). */
function DataTableForScreenReaders({ data, x, series, title, xLabel, formatX, formatValue }: Required<Pick<ChartProps, "data" | "x" | "series" | "title">> & {
  xLabel: string;
  formatX: (v: unknown) => string;
  formatValue: (v: number) => string;
}) {
  // sr-only goes on a wrapper: a <table> ignores width:1px and would widen the page.
  return (
    <div className="sr-only">
    <table>
      <caption>{title}</caption>
      <thead>
        <tr>
          <th scope="col">{xLabel}</th>
          {series.map((s) => (
            <th key={s.key} scope="col">
              {s.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((d, i) => (
          <tr key={i}>
            <th scope="row">{formatX(d[x])}</th>
            {series.map((s) => (
              <td key={s.key}>{typeof d[s.key] === "number" ? formatValue(d[s.key] as number) : "—"}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

function useChartBasics(props: ChartProps) {
  const rawId = useId();
  const reducedMotion = useReducedMotion();
  const series = props.series.slice(0, 3);
  if (process.env.NODE_ENV !== "production" && props.series.length > 3) {
    console.warn(`[charts] "${props.title}": max 3 series; fold the rest into "Other" or use small multiples.`);
  }
  const formatX = props.formatX ?? defaultFormat;
  const formatY = props.formatY ?? ((v: number) => defaultFormat(v));
  const formatValue = props.formatValue ?? formatY;
  return {
    gid: `chart${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
    reducedMotion,
    series,
    formatX,
    formatY,
    formatValue,
    height: props.height ?? 240,
  };
}

function Frame({
  props,
  mark,
  basics,
  children,
}: {
  props: ChartProps;
  mark: "area" | "line";
  basics: ReturnType<typeof useChartBasics>;
  children: ReactNode;
}) {
  const { data, x, title, xLabel = "Date", loading, empty, className } = props;
  const { series, formatX, formatValue, height } = basics;
  return (
    <figure aria-label={title} className={cn("w-full", className)}>
      <Legend series={series} mark={mark} />
      {loading ? (
        <div style={{ height }} className="w-full" aria-busy>
          <Skeleton className="h-full w-full rounded-xl" />
        </div>
      ) : data.length === 0 ? (
        <div
          className="flex w-full items-center justify-center rounded-xl border border-dashed border-line text-sm text-muted"
          style={{ height }}
        >
          {empty ?? "No data yet"}
        </div>
      ) : (
        <div style={{ height }} className="w-full">
          {children}
        </div>
      )}
      {!loading && data.length > 0 && (
        <DataTableForScreenReaders data={data} x={x} series={series} title={title} xLabel={xLabel} formatX={formatX} formatValue={formatValue} />
      )}
    </figure>
  );
}

const AXIS_TICK = { fill: "var(--color-chart-axis)", fontSize: 12 };

/**
 * Area chart: blue line on a light-blue wash (share price, TVL).
 *
 *   <AreaChart
 *     title="Share price"
 *     data={points.map((p) => ({ t: p.t, price: p.sharePrice }))}
 *     x="t"
 *     series={[{ key: "price", label: "Share price" }]}
 *     formatX={(t) => formatShortDate(t as number)}
 *     formatY={(v) => `€${v.toFixed(3)}`}
 *     yDomain={["auto", "auto"]}
 *   />
 */
export function AreaChart(props: ChartProps) {
  const basics = useChartBasics(props);
  const { gid, reducedMotion, series, formatX, formatY, formatValue, height } = basics;
  return (
    <Frame props={props} mark="area" basics={basics}>
      <RechartsAreaChart responsive width="100%" height={height} data={props.data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.key} id={`${gid}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colorOf(s, i)} stopOpacity={0.2} />
              <stop offset="100%" stopColor={colorOf(s, i)} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} stroke="var(--color-chart-grid)" />
        <XAxis
          dataKey={props.x}
          tickFormatter={formatX}
          tickLine={false}
          axisLine={{ stroke: "var(--color-chart-grid)" }}
          tick={AXIS_TICK}
          tickMargin={8}
          minTickGap={28}
        />
        <YAxis
          width="auto"
          tickFormatter={formatY}
          tickLine={false}
          axisLine={false}
          tick={AXIS_TICK}
          tickMargin={6}
          tickCount={5}
          domain={props.yDomain ?? [0, "auto"]}
        />
        <Tooltip
          cursor={{ stroke: "var(--color-chart-axis)", strokeOpacity: 0.4, strokeWidth: 1 }}
          isAnimationActive={false}
          content={<ChartTooltipContent formatX={formatX} formatValue={formatValue} />}
        />
        {series.map((s, i) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={colorOf(s, i)}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill={`url(#${gid}-${i})`}
            fillOpacity={1}
            dot={false}
            activeDot={{ r: 4.5, stroke: "var(--color-card)", strokeWidth: 2, fill: colorOf(s, i) }}
            isAnimationActive={!reducedMotion}
            animationDuration={500}
          />
        ))}
      </RechartsAreaChart>
    </Frame>
  );
}

/**
 * Line chart: 2 px lines, no fill (e.g. TVL vs outstanding debt, both in euros
 * on one axis; never two y-scales).
 */
export function LineChart(props: ChartProps) {
  const basics = useChartBasics(props);
  const { reducedMotion, series, formatX, formatY, formatValue, height } = basics;
  return (
    <Frame props={props} mark="line" basics={basics}>
      <RechartsLineChart responsive width="100%" height={height} data={props.data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--color-chart-grid)" />
        <XAxis
          dataKey={props.x}
          tickFormatter={formatX}
          tickLine={false}
          axisLine={{ stroke: "var(--color-chart-grid)" }}
          tick={AXIS_TICK}
          tickMargin={8}
          minTickGap={28}
        />
        <YAxis
          width="auto"
          tickFormatter={formatY}
          tickLine={false}
          axisLine={false}
          tick={AXIS_TICK}
          tickMargin={6}
          tickCount={5}
          domain={props.yDomain ?? [0, "auto"]}
        />
        <Tooltip
          cursor={{ stroke: "var(--color-chart-axis)", strokeOpacity: 0.4, strokeWidth: 1 }}
          isAnimationActive={false}
          content={<ChartTooltipContent formatX={formatX} formatValue={formatValue} />}
        />
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={colorOf(s, i)}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={false}
            activeDot={{ r: 4.5, stroke: "var(--color-card)", strokeWidth: 2, fill: colorOf(s, i) }}
            isAnimationActive={!reducedMotion}
            animationDuration={500}
          />
        ))}
      </RechartsLineChart>
    </Frame>
  );
}
