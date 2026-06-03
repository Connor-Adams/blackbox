"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { annotationTypes } from "@/lib/db/schema";

export function AnnotationForm({ date }: { date: string }) {
  const router = useRouter();
  const [type, setType] = useState<string>("note");
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("12:00");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const timestamp = new Date(`${date}T${time}:00Z`).toISOString();
    const res = await fetch("/api/annotations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, title, timestamp, notes: notes || undefined }),
    });
    setBusy(false);
    if (!res.ok) {
      setError("Could not save annotation.");
      return;
    }
    setTitle("");
    setNotes("");
    router.refresh();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-2 rounded-lg border border-border p-3"
    >
      <div className="text-sm font-medium">Add annotation</div>
      <div className="flex flex-wrap gap-2">
        <select value={type} onChange={(e) => setType(e.target.value)} className="rounded border border-border bg-background px-2 py-1 text-sm">
          {annotationTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <input value={time} onChange={(e) => setTime(e.target.value)} type="time" className="rounded border border-border bg-background px-2 py-1 text-sm" />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" required className="flex-1 rounded border border-border bg-background px-2 py-1 text-sm" />
      </div>
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" className="w-full rounded border border-border bg-background px-2 py-1 text-sm" />
      {error && <div className="text-xs text-destructive">{error}</div>}
      <Button type="submit" disabled={busy || !title}>{busy ? "Saving…" : "Add"}</Button>
    </form>
  );
}
