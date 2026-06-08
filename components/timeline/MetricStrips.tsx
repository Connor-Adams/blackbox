"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MetricSeriesDTO } from "@/lib/api/timeline-dto";

/** Metrics with at least this many points get a chart; fewer render as a chip. */
const INTRADAY_MIN = 8;

const LABELS: Record<string, string> = {
  heart_rate: "Heart rate",
  resting_heart_rate: "Resting HR",
  stress: "Stress",
  body_battery: "Body battery",
  spo2: "SpO₂",
  respiration: "Respiration",
  hrv: "HRV",
  steps: "Steps",
  floors: "Floors",
  intensity_minutes: "Intensity min",
  calories: "Active calories",
  vo2max: "VO₂ max",
  training_readiness: "Training readiness",
  sleep_duration: "Sleep",
};

function label(metric: string): string {
  return LABELS[metric] ?? metric.replace(/_/g, " ");
}

function formatValue(metric: string, value: number): string {
  if (metric === "sleep_duration") {
    const h = Math.floor(value / 3600);
    const m = Math.round((value % 3600) / 60);
    return `${h}h ${m}m`;
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function MetricChart({ s }: { s: MetricSeriesDTO }) {
  const data = s.points.map((p) => ({ time: timeOf(p.observedAt), value: p.value }));
  const values = s.points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm font-medium">{label(s.metric)}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatValue(s.metric, lo)}–{formatValue(s.metric, hi)} {s.unit}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={88}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
          <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={48} />
          <YAxis tick={{ fontSize: 10 }} width={28} domain={["auto", "auto"]} />
          <Tooltip />
          <Line type="monotone" dataKey="value" stroke="currentColor" dot={false} strokeWidth={1.5} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MetricStrips({ series }: { series: MetricSeriesDTO[] }) {
  if (!series || series.length === 0) return null;
  const intraday = series.filter((s) => s.points.length >= INTRADAY_MIN);
  const daily = series.filter((s) => s.points.length < INTRADAY_MIN);

  return (
    <div className="space-y-3">
      {daily.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {daily.map((s) => {
            const latest = s.points[s.points.length - 1];
            return (
              <div key={s.metric} className="rounded-lg border border-border px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label(s.metric)}</div>
                <div className="text-sm font-medium tabular-nums">
                  {formatValue(s.metric, latest.value)}
                  {s.metric !== "sleep_duration" && <span className="ml-1 text-xs font-normal text-muted-foreground">{s.unit}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {intraday.map((s) => (
        <MetricChart key={s.metric} s={s} />
      ))}
    </div>
  );
}
