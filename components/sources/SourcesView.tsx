"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { SourceDTO } from "@/lib/api/source-dto";

export function SourcesView({ sources }: { sources: SourceDTO[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});

  async function sync(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/sources/${id}/sync`, { method: "POST" });
      const data = await res.json();
      setMsg((m) => ({ ...m, [id]: res.ok ? `synced: +${data.created} new` : `error: ${data.error}` }));
      router.refresh();
    } catch {
      setMsg((m) => ({ ...m, [id]: "sync failed" }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-xl font-semibold tracking-tight">Sources</h1>
      {sources.length === 0 ? (
        <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">No sources configured.</div>
      ) : (
        <ul className="space-y-2">
          {sources.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{s.displayName}</span>
                  <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">{s.sourceType}</span>
                  <span className="text-[10px] uppercase text-muted-foreground">{s.status}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {s.lastSyncAt ? `last sync ${new Date(s.lastSyncAt).toLocaleString()}` : "never synced"}
                  {msg[s.id] ? ` · ${msg[s.id]}` : ""}
                </div>
              </div>
              {s.sourceType === "manual" ? (
                <span className="text-xs text-muted-foreground">UI-logged</span>
              ) : (
                <Button type="button" onClick={() => sync(s.id)} disabled={busy === s.id}>
                  {busy === s.id ? "Syncing…" : "Sync"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
