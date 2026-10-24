"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Settings } from "lucide-react";
import { ServerForm } from "@/components/server-form";
import { BoardSkeleton, ServerBoard } from "@/components/server-board";
import { SettingsPanel } from "@/components/settings-panel";
import { Button } from "@/components/ui/button";
import { POLL_INTERVAL_MS, type MetricsSnapshot, type Overview, type ServerCard } from "@/lib/types";

type Mode = "board" | "settings" | "create" | "edit";

export function AppShell() {
  const [servers, setServers] = useState<ServerCard[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("board");
  const [snapshot, setSnapshot] = useState<MetricsSnapshot | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    const response = await fetch("/api/overview", { cache: "no-store" });
    if (!response.ok) throw new Error("Не удалось загрузить список серверов.");
    const body = (await response.json()) as Overview;
    setServers(body.servers);
    setSelectedId((current) => current ?? body.servers[0]?.id ?? null);
    return body.servers;
  }, []);

  const loadBoard = useCallback(async (serverId: string) => {
    const response = await fetch(`/api/metrics?serverId=${encodeURIComponent(serverId)}`, { cache: "no-store" });
    const body = (await response.json()) as MetricsSnapshot & { error?: string };
    if (!response.ok) throw new Error(body.error || "Не удалось открыть сервер.");
    setSnapshot(body);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        await loadOverview();
        if (!cancelled) setProblem(null);
      } catch (error) {
        if (!cancelled) setProblem(error instanceof Error ? error.message : "Нет связи с панелью.");
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    }
    void tick();
    const timer = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loadOverview]);

  useEffect(() => {
    if (!selectedId || mode !== "board") return;
    const serverId = selectedId;
    let cancelled = false;
    async function tick() {
      try {
        await loadBoard(serverId);
        if (!cancelled) setProblem(null);
      } catch (error) {
        if (!cancelled) setProblem(error instanceof Error ? error.message : "Не удалось открыть сервер.");
      }
    }
    void tick();
    const timer = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedId, mode, loadBoard]);

  async function refresh() {
    if (!selectedId) return;
    setRefreshing(true);
    try {
      const response = await fetch("/api/metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverId: selectedId }),
      });
      const body = (await response.json()) as MetricsSnapshot & { error?: string };
      if (!response.ok) throw new Error(body.error || "Не удалось обновить.");
      setSnapshot(body);
      await loadOverview();
      setProblem(null);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Не удалось обновить.");
    } finally {
      setRefreshing(false);
    }
  }

  const selected = servers.find((server) => server.id === selectedId) ?? null;
  const boardLoading =
    mode === "board" && selectedId != null && snapshot?.server.id !== selectedId && !problem;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col gap-4 px-3 py-3 md:flex-row md:px-5 md:py-5">
      <aside className="rise flex shrink-0 flex-col gap-3 md:w-72">
        <div className="px-1">
          <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">mmmetrics</p>
        </div>
        <div className="flex gap-2 overflow-x-auto md:flex-col md:overflow-visible">
          {servers.map((server, index) => (
            <button
              key={server.id}
              type="button"
              style={{ animationDelay: `${index * 50}ms` }}
              className={`rise min-w-44 rounded-2xl border px-3 py-3 text-left transition duration-200 hover:-translate-y-0.5 md:min-w-0 ${
                mode === "board" && server.id === selectedId
                  ? "border-primary/50 bg-primary/10"
                  : "border-white/10 bg-card/70 hover:border-white/20"
              }`}
              onClick={() => {
                setMode("board");
                setSelectedId(server.id);
                setSnapshot(null);
              }}
            >
              <span className="flex items-center gap-2">
                <Dot online={server.online} />
                <span className="truncate font-medium">{server.name}</span>
              </span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">{server.host}</span>
            </button>
          ))}
        </div>
        <Button type="button" variant="outline" className="h-11 justify-start px-3" onClick={() => setMode("create")}>
          <Plus />
          Добавить сервер
        </Button>
        <Button type="button" variant={mode === "settings" ? "secondary" : "ghost"} className="h-11 justify-start px-3" onClick={() => setMode("settings")}>
          <Settings />
          Алерты и Telegram
        </Button>
      </aside>

      <main className="min-w-0 flex-1">
        {problem ? (
          <p className="mb-4 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">{problem}</p>
        ) : null}
        {loadingList && servers.length === 0 ? <BoardSkeleton /> : null}
        {!loadingList && servers.length === 0 && mode === "board" ? <Welcome onAdd={() => setMode("create")} /> : null}
        {mode === "create" ? (
          <ServerForm
            onCancel={() => setMode(servers.length ? "board" : "board")}
            onSaved={(id) => {
              setSelectedId(id);
              setSnapshot(null);
              setMode("board");
              void loadOverview();
            }}
          />
        ) : null}
        {mode === "edit" && selected ? (
          <ServerForm
            initial={selected}
            onCancel={() => setMode("board")}
            onSaved={() => {
              setMode("board");
              void loadOverview();
            }}
          />
        ) : null}
        {mode === "settings" ? <SettingsPanel servers={servers} /> : null}
        {mode === "board" && selectedId ? (
          <div className="flex flex-col gap-3">
            {selected ? (
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" className="h-9" onClick={() => setMode("edit")}>
                  Изменить
                </Button>
                <DeleteServer
                  id={selected.id}
                  onDeleted={() => {
                    setSelectedId(null);
                    setSnapshot(null);
                    void loadOverview();
                  }}
                />
              </div>
            ) : null}
            {boardLoading ? <BoardSkeleton /> : null}
            {snapshot && snapshot.server.id === selectedId ? (
              <ServerBoard data={snapshot} refreshing={refreshing} onRefresh={() => void refresh()} />
            ) : null}
          </div>
        ) : null}
      </main>
    </div>
  );
}

function Dot({ online }: { online: boolean | null }) {
  const color = online == null ? "bg-muted-foreground" : online ? "bg-emerald-300" : "bg-red-300";
  return <span className={`size-2 shrink-0 rounded-full ${color} ${online ? "animate-pulse" : ""}`} />;
}

function Welcome({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rise flex min-h-[60vh] flex-col items-start justify-center gap-4">
      <h1 className="text-3xl font-semibold tracking-tight">Нет серверов</h1>
      <Button type="button" className="h-11 px-4" onClick={onAdd}>
        <Plus />
        Добавить сервер
      </Button>
    </div>
  );
}

function DeleteServer({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    const response = await fetch(`/api/servers/${id}`, { method: "DELETE" });
    setBusy(false);
    if (response.ok) onDeleted();
  }

  if (!confirming) {
    return (
      <Button type="button" variant="ghost" className="h-9 text-destructive" onClick={() => setConfirming(true)}>
        Удалить
      </Button>
    );
  }
  return (
    <Button type="button" variant="destructive" className="h-9" disabled={busy} onClick={() => void remove()}>
      {busy ? "Удаляем" : "Точно удалить"}
    </Button>
  );
}
