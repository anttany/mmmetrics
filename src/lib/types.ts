// Совпадает с интервалом опроса в backend/store.py.
export const POLL_INTERVAL_MS = 15_000;
export const HISTORY_WINDOW_MS = 2 * 60 * 60 * 1000;
export const RETENTION_MS = 6 * 60 * 60 * 1000;

export const ALERT_METRICS = ["cpu", "memory", "disk", "load", "offline"] as const;
export type AlertMetric = (typeof ALERT_METRICS)[number];

export type ServerPublic = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  hasPassword: boolean;
};

export type ServerDraft = {
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
};

export type Sample = {
  id: number;
  ts: number;
  online: boolean;
  hostname: string | null;
  uptimeSeconds: number | null;
  load1: number | null;
  load5: number | null;
  load15: number | null;
  cpuCount: number | null;
  cpuPercent: number | null;
  memTotal: number | null;
  memUsed: number | null;
  memPercent: number | null;
  diskTotal: number | null;
  diskUsed: number | null;
  diskPercent: number | null;
  diskMount: string | null;
  error: string | null;
};

export type NewSample = Omit<Sample, "id">;

export type ServerCard = ServerPublic & {
  online: boolean | null;
  hostname: string | null;
  uptimeSeconds: number | null;
  cpuPercent: number | null;
  memPercent: number | null;
  diskPercent: number | null;
  load1: number | null;
  error: string | null;
  collectedAt: number | null;
  activeAlerts: number;
};

export type MetricsSnapshot = {
  server: ServerPublic;
  intervalMs: number;
  historyWindowMs: number;
  latest: Sample | null;
  lastOk: Sample | null;
  history: Sample[];
  error: string | null;
  collectedAt: number | null;
  activeAlerts: number;
  recentAlerts: AlertLogEntry[];
};

export type TelegramSettings = {
  enabled: boolean;
  hasToken: boolean;
  tokenHint: string | null;
  chatId: string;
};

export type AlertRule = {
  id: string;
  serverId: string | null;
  metric: AlertMetric;
  threshold: number;
  enabled: boolean;
  cooldownSec: number;
};

export type AlertLogEntry = {
  id: number;
  ts: number;
  serverId: string | null;
  ruleId: string | null;
  message: string;
  sent: boolean;
};

export type Overview = {
  intervalMs: number;
  servers: ServerCard[];
};
