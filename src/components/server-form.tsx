"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ServerPublic } from "@/lib/types";

const fieldClass =
  "h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm outline-none transition duration-200 focus:border-primary/70 focus:ring-3 focus:ring-primary/20";

export function ServerForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial?: ServerPublic | null;
  onCancel: () => void;
  onSaved: (id: string) => void;
}) {
  const editing = Boolean(initial);
  const [name, setName] = useState(initial?.name ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(String(initial?.port ?? 22));
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name,
        host,
        port: Number(port),
        username,
        password,
      };
      const response = await fetch(editing ? `/api/servers/${initial!.id}` : "/api/servers", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { server?: { id: string }; error?: string };
      if (!response.ok || !body.server) throw new Error(body.error || "Не удалось сохранить сервер.");
      onSaved(body.server.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить сервер.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="slide-in bg-card/85 backdrop-blur-sm">
      <CardHeader>
        <CardTitle>{editing ? "Изменить сервер" : "Новый сервер"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3" onSubmit={(event) => void submit(event)}>
          <Field label="Название" value={name} onChange={setName} />
          <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
            <Field label="Адрес" value={host} onChange={setHost} />
            <Field label="Порт" value={port} onChange={setPort} />
          </div>
          <Field label="Пользователь" value={username} onChange={setUsername} />
          <label className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground">Пароль</span>
            <input
              className={fieldClass}
              type="password"
              autoComplete="new-password"
              value={password}
              placeholder={editing ? "Без изменений" : ""}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex gap-2 pt-1">
            <Button type="submit" className="h-11 px-4" disabled={saving}>
              {saving ? "Сохраняем" : "Сохранить"}
            </Button>
            <Button type="button" variant="outline" className="h-11 px-4" onClick={onCancel}>
              Отмена
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <input className={fieldClass} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
