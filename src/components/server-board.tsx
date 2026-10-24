"use client";

import type { ReactNode } from "react";
import { Clock3, Cpu, Gauge, HardDrive, MemoryStick, RefreshCw, TriangleAlert } from "lucide-react";
import { MetricChart, toPoints } from "@/components/metric-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatBytes,
  formatChartValue,
  formatClock,
  formatDateTime,
  formatLoad,
  formatPercent,
  formatUptime,
  plural,
} from "@/lib/format";
import type { MetricsSnapshot, Sample } from "@/lib/types";

export function ServerBoard({
  data,
  refreshing,
  onRefresh,
}: {
  data: MetricsSnapshot;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const sample = data.lastOk;
  const offline = Boolean(data.error);

  return (
    <div className="flex flex-col gap-4">
      <header className="rise flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium tracking-[0.16em] text-primary uppercase">{data.server.name}</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {sample?.hostname ?? data.server.host}
          </h1>
          <p className="text-sm text-muted-foreground">
            {data.server.username}@{data.server.host}:{data.server.port}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-muted-foreground">
            {data.collectedAt ? `Обновлено в ${formatClock(data.collectedAt)}` : "Нет данных"}
          </p>
          <Button type="button" variant="outline" className="h-11 px-4" disabled={refreshing} onClick={onRefresh}>
            <RefreshCw className={refreshing ? "animate-spin" : undefined} />
            {refreshing ? "Опрашиваем" : "Обновить"}
          </Button>
        </div>
      </header>

      {data.error ? (
        <Notice
          title="Нет связи"
          text={
            sample
              ? `${data.error} Данные от ${formatDateTime(sample.ts)}.`
              : data.error
          }
        />
      ) : null}

      {data.recentAlerts.length > 0 ? (
        <div className="rise rounded-2xl border border-amber-300/20 bg-amber-300/8 px-4 py-3 text-sm" style={{ animationDelay: "40ms" }}>
          <p className="font-medium">Последний алерт</p>
          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
            {formatDateTime(data.recentAlerts[0]!.ts)} · {data.recentAlerts[0]!.message}
          </p>
        </div>
      ) : null}

      {!sample && !data.error ? <EmptyState /> : null}

      {sample ? (
        <>
          <StatusCard sample={sample} offline={offline} />
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              delay={80}
              icon={<Cpu />}
              title="Процессор"
              value={formatPercent(sample.cpuPercent)}
              detail={
                sample.cpuCount
                  ? `${sample.cpuCount} ${plural(sample.cpuCount, "ядро", "ядра", "ядер")}`
                  : ""
              }
              meter={sample.cpuPercent}
            />
            <MetricCard
              delay={130}
              icon={<MemoryStick />}
              title="Память"
              value={formatPercent(sample.memPercent)}
              detail={`${formatBytes(sample.memUsed)} из ${formatBytes(sample.memTotal)}`}
              meter={sample.memPercent}
            />
            <MetricCard
              delay={180}
              icon={<HardDrive />}
              title="Диск"
              value={formatPercent(sample.diskPercent)}
              detail={`${formatBytes(sample.diskUsed)} из ${formatBytes(sample.diskTotal)} · ${sample.diskMount ?? "/"}`}
              meter={sample.diskPercent}
            />
            <Card className="rise bg-card/80 backdrop-blur-sm" style={{ animationDelay: "230ms" }}>
              <CardHeader>
                <CardDescription className="flex items-center gap-2">
                  <Gauge className="size-4" />
                  Нагрузка
                </CardDescription>
                <CardTitle>
                  <Figure text={formatChartValue(sample.load1 ?? Number.NaN, "load")} />
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-2 text-sm">
                <LoadCell label="1 мин" value={sample.load1} cpus={sample.cpuCount} />
                <LoadCell label="5 мин" value={sample.load5} cpus={sample.cpuCount} />
                <LoadCell label="15 мин" value={sample.load15} cpus={sample.cpuCount} />
              </CardContent>
            </Card>
          </section>

          <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ChartCard delay={80} title="Процессор" description="%, 2 часа">
              <MetricChart
                label="Процессор"
                unit="percent"
                color="var(--chart-1)"
                domain={[0, 100]}
                data={toPoints(data.history.map((item) => ({ ts: item.ts, value: item.cpuPercent })))}
              />
            </ChartCard>
            <ChartCard delay={140} title="Память" description="%, 2 часа">
              <MetricChart
                label="Память"
                unit="percent"
                color="var(--chart-2)"
                domain={[0, 100]}
                data={toPoints(data.history.map((item) => ({ ts: item.ts, value: item.memPercent })))}
              />
            </ChartCard>
            <ChartCard delay={200} title="Диск" description={`% · ${sample.diskMount ?? "/"}`}>
              <MetricChart
                label="Диск"
                unit="percent"
                color="var(--chart-3)"
                domain={[0, 100]}
                data={toPoints(data.history.map((item) => ({ ts: item.ts, value: item.diskPercent })))}
              />
            </ChartCard>
            <ChartCard delay={260} title="Нагрузка" description="load, 1 мин">
              <MetricChart
                label="Нагрузка"
                unit="load"
                color="var(--chart-4)"
                data={toPoints(data.history.map((item) => ({ ts: item.ts, value: item.load1 })))}
              />
            </ChartCard>
          </section>
        </>
      ) : null}
    </div>
  );
}

export function BoardSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      <p className="text-sm text-muted-foreground">Загрузка</p>
      <Skeleton className="h-28 w-full rounded-2xl" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Skeleton className="h-36 rounded-2xl" />
        <Skeleton className="h-36 rounded-2xl" />
        <Skeleton className="h-36 rounded-2xl" />
        <Skeleton className="h-36 rounded-2xl" />
      </div>
    </div>
  );
}

function Figure({ text }: { text: string }) {
  return <span key={text} className="pop inline-block font-mono text-3xl font-semibold tabular-nums">{text}</span>;
}

function StatusCard({ sample, offline }: { sample: Sample; offline: boolean }) {
  return (
    <Card className="rise bg-card/80 backdrop-blur-sm" style={{ animationDelay: "40ms" }}>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Badge
            variant={offline ? "destructive" : "secondary"}
            className={offline ? "h-6 px-2.5" : "h-6 bg-emerald-400/15 px-2.5 text-emerald-200"}
          >
            <span className={`size-1.5 rounded-full ${offline ? "bg-red-300" : "animate-pulse bg-emerald-300"}`} />
            {offline ? "Не в сети" : "В сети"}
          </Badge>
          <p className="font-mono text-2xl font-semibold tracking-tight">{sample.hostname}</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock3 className="size-4 shrink-0" />
          <div>
            <p className="text-xs tracking-wide uppercase">Время работы</p>
            <p className="text-base text-foreground">{formatUptime(sample.uptimeSeconds)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricCard({
  icon,
  title,
  value,
  detail,
  meter,
  delay,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  detail: string;
  meter: number | null;
  delay: number;
}) {
  const width = meter == null ? 0 : Math.max(0, Math.min(100, meter));
  const bar =
    meter == null ? "bg-muted-foreground" : meter >= 90 ? "bg-red-400" : meter >= 75 ? "bg-amber-300" : "bg-emerald-400";
  return (
    <Card className="rise bg-card/80 backdrop-blur-sm" style={{ animationDelay: `${delay}ms` }}>
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <span className="text-foreground/80 [&_svg]:size-4">{icon}</span>
          {title}
        </CardDescription>
        <CardTitle>
          <Figure text={value} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{detail}</p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-foreground/10" aria-hidden>
          <div className={`h-full rounded-full transition-all duration-700 ${bar}`} style={{ width: `${width}%` }} />
        </div>
      </CardContent>
    </Card>
  );
}

function LoadCell({ label, value, cpus }: { label: string; value: number | null; cpus: number | null }) {
  const hot = value != null && cpus != null && value > cpus;
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`font-mono text-base tabular-nums ${hot ? "text-amber-200" : "text-foreground"}`}>
        {formatLoad(value)}
      </p>
    </div>
  );
}

function ChartCard({
  title,
  description,
  delay,
  children,
}: {
  title: string;
  description: string;
  delay: number;
  children: ReactNode;
}) {
  return (
    <Card className="rise min-w-0 bg-card/80 backdrop-blur-sm" style={{ animationDelay: `${delay}ms` }}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <div className="rise flex gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <Card className="rise">
      <CardHeader>
        <CardTitle>Нет данных</CardTitle>
      </CardHeader>
    </Card>
  );
}
