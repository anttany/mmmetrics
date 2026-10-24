"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import type { AlertLogEntry, AlertMetric, AlertRule, ServerPublic, TelegramSettings } from "@/lib/types";

const fieldClass =
  "h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm outline-none transition duration-200 focus:border-primary/70 focus:ring-3 focus:ring-primary/20";

const METRICS: { id: AlertMetric; label: string; unit: string }[] = [
  { id: "cpu", label: "Процессор", unit: "%" },
  { id: "memory", label: "Память", unit: "%" },
  { id: "disk", label: "Диск", unit: "%" },
  { id: "load", label: "Нагрузка за 1 мин", unit: "load" },
  { id: "offline", label: "Нет связи", unit: "" },
];

export function SettingsPanel({ servers }: { servers: ServerPublic[] }) {
  const [telegram, setTelegram] = useState<TelegramSettings | null>(null);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [log, setLog] = useState<AlertLogEntry[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [metric, setMetric] = useState<AlertMetric>("cpu");
  const [threshold, setThreshold] = useState("90");
  const [serverId, setServerId] = useState("");
  const [cooldownSec, setCooldownSec] = useState("600");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/alerts", { cache: "no-store" });
    if (!response.ok) throw new Error("Не удалось открыть настройки.");
    const body = (await response.json()) as {
      telegram: TelegramSettings;
      rules: AlertRule[];
      log: AlertLogEntry[];
    };
    setTelegram(body.telegram);
    setRules(body.rules);
    setLog(body.log);
    setEnabled(body.telegram.enabled);
    setChatId(body.telegram.chatId);
  }

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const response = await fetch("/api/alerts", { cache: "no-store" });
        if (!response.ok) throw new Error("Не удалось открыть настройки.");
        const body = (await response.json()) as {
          telegram: TelegramSettings;
          rules: AlertRule[];
          log: AlertLogEntry[];
        };
        if (cancelled) return;
        setTelegram(body.telegram);
        setRules(body.rules);
        setLog(body.log);
        setEnabled(body.telegram.enabled);
        setChatId(body.telegram.chatId);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Не удалось открыть настройки.");
        }
      }
    }
    void tick();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveTelegram() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/telegram", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, token, chatId }),
      });
      const body = (await response.json()) as { telegram?: TelegramSettings; error?: string };
      if (!response.ok || !body.telegram) throw new Error(body.error || "Не удалось сохранить Telegram.");
      setTelegram(body.telegram);
      setToken("");
      setMessage("Сохранено");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить Telegram.");
    } finally {
      setBusy(false);
    }
  }

  async function testTelegram() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await saveTelegram();
      const response = await fetch("/api/telegram", { method: "POST" });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Сообщение не отправлено");
      setMessage("Сообщение отправлено");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Сообщение не отправлено");
    } finally {
      setBusy(false);
    }
  }

  async function addRule() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverId: serverId || null,
          metric,
          threshold: Number(threshold),
          enabled: true,
          cooldownSec: Number(cooldownSec),
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Не удалось добавить алерт.");
      setMessage("Алерт добавлен.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось добавить алерт.");
    } finally {
      setBusy(false);
    }
  }

  async function removeRule(id: string) {
    setError(null);
    const response = await fetch(`/api/alerts/${id}`, { method: "DELETE" });
    if (!response.ok) {
      setError("Не удалось удалить алерт.");
      return;
    }
    await load();
  }

  async function toggleRule(rule: AlertRule) {
    const response = await fetch(`/api/alerts/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...rule, serverId: rule.serverId, enabled: !rule.enabled }),
    });
    if (!response.ok) {
      setError("Не удалось изменить алерт.");
      return;
    }
    await load();
  }

  return (
    <div className="slide-in flex flex-col gap-4">
      <div>
        <p className="text-xs font-medium tracking-[0.16em] text-primary uppercase">Настройки</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Алерты</h1>
      </div>

      {error ? <p className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">{error}</p> : null}
      {message ? <p className="rounded-2xl border border-emerald-300/30 bg-emerald-300/10 px-4 py-3 text-sm">{message}</p> : null}

      <Card className="bg-card/80 backdrop-blur-sm">
        <CardHeader>
          <CardTitle>Telegram</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            Отправлять алерты в Telegram
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground">
              Токен{telegram?.tokenHint ? ` ${telegram.tokenHint}` : ""}
            </span>
            <input
              className={fieldClass}
              type="password"
              autoComplete="off"
              value={token}
              placeholder={telegram?.hasToken ? "Без изменений" : ""}
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground">Chat id</span>
            <input className={fieldClass} value={chatId} onChange={(event) => setChatId(event.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="h-11 px-4" disabled={busy} onClick={() => void saveTelegram()}>
              Сохранить
            </Button>
            <Button type="button" variant="outline" className="h-11 px-4" disabled={busy} onClick={() => void testTelegram()}>
              Проверить
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/80 backdrop-blur-sm">
        <CardHeader>
          <CardTitle>Пороги</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            <Preset label="Процессор 90 %" onClick={() => { setMetric("cpu"); setThreshold("90"); }} />
            <Preset label="Память 90 %" onClick={() => { setMetric("memory"); setThreshold("90"); }} />
            <Preset label="Диск 85 %" onClick={() => { setMetric("disk"); setThreshold("85"); }} />
            <Preset label="Нагрузка 2 load" onClick={() => { setMetric("load"); setThreshold("2"); }} />
            <Preset label="Нет связи" onClick={() => { setMetric("offline"); setThreshold("0"); }} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">Сервер</span>
              <select className={fieldClass} value={serverId} onChange={(event) => setServerId(event.target.value)}>
                <option value="">Все серверы</option>
                {servers.map((server) => (
                  <option key={server.id} value={server.id}>{server.name}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">Метрика</span>
              <select className={fieldClass} value={metric} onChange={(event) => setMetric(event.target.value as AlertMetric)}>
                {METRICS.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </label>
            {metric === "offline" ? null : (
              <label className="grid gap-1.5 text-sm">
                <span className="text-muted-foreground">Порог, {METRICS.find((item) => item.id === metric)?.unit}</span>
                <input className={fieldClass} inputMode="decimal" value={threshold} onChange={(event) => setThreshold(event.target.value)} />
              </label>
            )}
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">Пауза перед повтором</span>
              <select className={fieldClass} value={cooldownSec} onChange={(event) => setCooldownSec(event.target.value)}>
                <option value="300">5 минут</option>
                <option value="600">10 минут</option>
                <option value="1800">30 минут</option>
                <option value="3600">60 минут</option>
              </select>
            </label>
          </div>
          <Button type="button" className="h-11 w-fit px-4" disabled={busy} onClick={() => void addRule()}>
            Добавить алерт
          </Button>
          <ul className="grid gap-2">
            {rules.length === 0 ? <li className="text-sm text-muted-foreground">Нет алертов</li> : null}
            {rules.map((rule) => (
              <li key={rule.id} className="flex flex-col gap-2 rounded-xl border border-white/10 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">{ruleText(rule, servers)}</p>
                  <p className="text-xs text-muted-foreground">{rule.enabled ? "Включён" : "Выключен"}</p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="h-9" onClick={() => void toggleRule(rule)}>
                    {rule.enabled ? "Выключить" : "Включить"}
                  </Button>
                  <Button type="button" variant="destructive" className="h-9" onClick={() => void removeRule(rule.id)}>
                    Удалить
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="bg-card/80 backdrop-blur-sm">
        <CardHeader>
          <CardTitle>Журнал</CardTitle>
        </CardHeader>
        <CardContent>
          {log.length === 0 ? <p className="text-sm text-muted-foreground">Нет записей</p> : null}
          <ul className="grid gap-2">
            {log.map((entry) => (
              <li key={entry.id} className="rounded-xl bg-white/4 px-3 py-2 text-sm">
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(entry.ts)} · {entry.sent ? "отправлено" : "не отправлено"}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{entry.message}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function Preset({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs transition hover:-translate-y-0.5 hover:border-primary/40"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function ruleText(rule: AlertRule, servers: ServerPublic[]): string {
  const metric = METRICS.find((item) => item.id === rule.metric);
  const server = rule.serverId ? servers.find((item) => item.id === rule.serverId)?.name ?? "сервер" : "все серверы";
  if (rule.metric === "offline") return `${server}: нет связи`;
  const value = rule.metric === "load" ? `${rule.threshold} load` : `${rule.threshold} %`;
  return `${server}: ${metric?.label ?? rule.metric} от ${value}`;
}
