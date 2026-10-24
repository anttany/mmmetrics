"use client";

import { Button } from "@/components/ui/button";

export default function DashboardError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-lg flex-col justify-center gap-4 px-4 py-16">
      <p className="text-sm tracking-[0.18em] text-primary uppercase">mmmetrics</p>
      <h1 className="text-2xl font-semibold">Ошибка</h1>
      <Button type="button" className="h-11 w-fit px-4" onClick={() => reset()}>
        Повторить
      </Button>
    </main>
  );
}
