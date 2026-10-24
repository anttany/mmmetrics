export function plural(value: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.floor(value)) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

export function formatUptime(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  if (days === 0 && hours === 0 && minutes === 0) return "меньше минуты";

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${plural(days, "день", "дня", "дней")}`);
  if (hours > 0) parts.push(`${hours} ${plural(hours, "час", "часа", "часов")}`);
  if (minutes > 0 && days === 0) {
    parts.push(`${minutes} ${plural(minutes, "минута", "минуты", "минут")}`);
  }
  return parts.join(" ");
}

export function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 1,
  }).format(value)} %`;
}

export function formatLoad(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatBytes(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const digits = index === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: digits,
  }).format(value)} ${units[index]}`;
}

export function formatClock(ts: number): string {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(ts));
}

export function formatDateTime(ts: number): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(ts));
}

export function formatChartValue(value: number, unit: "percent" | "load"): string {
  if (!Number.isFinite(value)) return "—";
  if (unit === "percent") {
    return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value)} %`;
  }
  return `${new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} load`;
}

export function formatChartTick(value: number, unit: "percent" | "load"): string {
  if (unit === "percent") {
    return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value)} %`;
  }
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);
}

export function formatAxisTime(ts: number): string {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
}
