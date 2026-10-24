"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatAxisTime, formatChartTick, formatChartValue, formatDateTime } from "@/lib/format";

type Point = {
  ts: number;
  label: string;
  value: number;
};

export function MetricChart({
  data,
  label,
  color,
  unit,
  domain,
}: {
  data: Point[];
  label: string;
  color: string;
  unit: "percent" | "load";
  domain?: [number, number];
}) {
  const config = {
    value: { label, color },
  } satisfies ChartConfig;

  if (data.length < 2) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-white/10 px-4 text-center text-sm text-muted-foreground">
        Нет данных
      </div>
    );
  }

  return (
    <ChartContainer config={config} className="aspect-auto h-52 w-full">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          minTickGap={28}
          tickMargin={8}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={unit === "percent" ? 58 : 42}
          domain={domain ?? ["auto", "auto"]}
          tickFormatter={(value: number) => formatChartTick(value, unit)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_value, payload) => {
                const point = payload?.[0]?.payload as Point | undefined;
                return point ? formatDateTime(point.ts) : "";
              }}
              formatter={(value) => (
                <div className="flex w-full items-center justify-between gap-4">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono font-medium tabular-nums">
                    {formatChartValue(numeric(value), unit)}
                  </span>
                </div>
              )}
            />
          }
        />
        <Area
          dataKey="value"
          type="monotone"
          stroke="var(--color-value)"
          fill="var(--color-value)"
          fillOpacity={0.2}
          strokeWidth={2}
          dot={false}
          isAnimationActive
          animationDuration={700}
        />
      </AreaChart>
    </ChartContainer>
  );
}

function numeric(value: unknown): number {
  if (typeof value === "number") return value;
  if (Array.isArray(value) && typeof value[0] === "number") return value[0];
  return Number(value);
}

export function toPoints(rows: { ts: number; value: number | null }[]): Point[] {
  const points = rows.flatMap((row) =>
    row.value == null || !Number.isFinite(row.value)
      ? []
      : [{ ts: row.ts, label: formatAxisTime(row.ts), value: row.value }],
  );
  return thin(points, 180);
}

function thin(points: Point[], max: number): Point[] {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  const kept: Point[] = [];
  for (let index = 0; index < points.length; index += step) kept.push(points[index]!);
  const last = points[points.length - 1];
  if (last && kept[kept.length - 1] !== last) kept.push(last);
  return kept;
}
