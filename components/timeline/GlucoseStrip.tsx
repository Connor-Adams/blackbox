"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { GlucosePointDTO } from "@/lib/api/timeline-dto";

export function GlucoseStrip({ glucose }: { glucose: GlucosePointDTO[] }) {
  if (glucose.length === 0) {
    return (
      <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
        No glucose readings for this day.
      </div>
    );
  }
  const data = glucose.map((g) => ({
    time: new Date(g.observedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    value: g.value,
  }));
  const unit = glucose[0]?.unit ?? "";
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 text-sm font-medium">Glucose ({unit})</div>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
          <XAxis dataKey="time" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 11 }} width={32} domain={["dataMin - 1", "dataMax + 1"]} />
          <Tooltip />
          <Line type="monotone" dataKey="value" stroke="currentColor" dot={false} strokeWidth={2} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
