import Link from "next/link";
import { getInsights } from "@/lib/db/insights";
import { getDailySnapshot } from "@/lib/db/snapshots";
import { getTrends } from "@/lib/db/trends";
import { getCorrelations } from "@/lib/db/correlations";
import { getTimeline } from "@/lib/db/store";
import { serializeInsights } from "@/lib/api/insight-dto";
import { computeDailySnapshot, type GlucoseSummary } from "@/lib/domain/snapshot";
import { SEED_USER_ID } from "@/lib/constants";
import { dayRange } from "@/lib/domain/time";
import type { TrendDirection } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function deltaColor(pct: number | null, invert = false): string {
  if (pct === null) return "text-zinc-500";
  const bad = invert ? pct < -3 : pct > 3;
  const good = invert ? pct > 3 : pct < -3;
  if (bad) return "text-amber-400";
  if (good) return "text-emerald-400";
  return "text-zinc-500";
}

function dirArrow(d: TrendDirection): string {
  if (d === "rising") return "▲";
  if (d === "falling") return "▼";
  return "→";
}

const INVERT_METRICS = new Set(["sleep_duration", "sleep_score", "steps", "intensity_minutes", "hrv", "body_battery", "training_readiness"]);

interface TrendRow {
  metric: string;
  value: number;
  delta7dPct: number | null;
  delta30dPct: number | null;
  baseline7d: number | null;
  direction: string;
  streak: number;
}

function formatMetricValue(metric: string, value: number): string {
  if (metric === "sleep_duration") return `${(value / 3600).toFixed(1)}h`;
  if (metric === "steps") return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value));
  if (metric === "hrv") return `${Math.round(value)}ms`;
  if (metric === "resting_heart_rate") return `${Math.round(value)}`;
  return String(Math.round(value));
}

function metricLabel(m: string): string {
  return m.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function narrativeSeverity(t: TrendRow): string {
  if (t.direction !== "stable" && Math.abs(t.delta30dPct ?? 0) > 10) return "border-l-amber-400";
  if (t.direction === "falling" && INVERT_METRICS.has(t.metric)) return "border-l-amber-400";
  if (t.direction === "rising" && INVERT_METRICS.has(t.metric)) return "border-l-emerald-400";
  return "border-l-zinc-700";
}

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date: rawDate } = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  let date = rawDate ?? today;
  try { dayRange(date); } catch { date = today; }

  const [snapshot, trends, correlations, insightRows, { events, observations }] = await Promise.all([
    getDailySnapshot(SEED_USER_ID, date),
    getTrends(SEED_USER_ID, date),
    getCorrelations(SEED_USER_ID, date),
    getInsights(SEED_USER_ID, date),
    getTimeline(SEED_USER_ID, date),
  ]);

  const summary = snapshot
    ? (snapshot.summaryJson as { glucose?: GlucoseSummary })
    : computeDailySnapshot({
        observations: observations.map((o) => ({ metric: o.metric, value: o.value })),
        timelineEvents: events.map((e) => ({ sourceType: e.sourceType, metadata: e.metadata })),
      });

  const allInsights = serializeInsights(insightRows);
  const glucoseTrend = trends.find((t) => t.metric === "glucose");
  const vitalTrends = trends.filter((t) => t.metric !== "glucose");
  const sigCorrelations = correlations.filter((c) => c.significant === 1);
  const pendingCorrelations = correlations.filter((c) => c.significant === 0);

  const annotations = events
    .filter((e) => e.sourceType === "manual")
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

  const recoveryMetrics = ["training_readiness", "body_battery", "sleep_score", "hrv"];
  const recoveryTrends = recoveryMetrics
    .map((m) => trends.find((t) => t.metric === m))
    .filter(Boolean) as typeof trends;

  return (
    <main className="min-h-screen bg-[#0a0a0f] p-4 font-mono text-xs text-zinc-300">
      {/* Header */}
      <header className="mb-4 flex items-center justify-between border-b border-zinc-800 pb-2">
        <h1 className="text-base font-semibold text-zinc-200">/today</h1>
        <div className="flex items-center gap-3 text-[11px] text-zinc-500">
          <nav className="flex items-center gap-1">
            <Link href={`/today?date=${shiftDate(date, -1)}`} className="rounded border border-zinc-800 px-1.5 py-0.5 hover:bg-zinc-800">←</Link>
            <span className="tabular-nums">{date}</span>
            <Link href={`/today?date=${shiftDate(date, 1)}`} className="rounded border border-zinc-800 px-1.5 py-0.5 hover:bg-zinc-800">→</Link>
          </nav>
          <span>{trends.length} metrics · {correlations.length} correlations</span>
        </div>
      </header>

      {/* 3-column grid */}
      <div className="grid grid-cols-[320px_1fr_340px] gap-4" style={{ minHeight: "calc(100vh - 80px)" }}>

        {/* LEFT — Glucose hero + Vitals */}
        <div className="flex flex-col gap-3">
          {/* Glucose Hero */}
          <div className="rounded-md border border-violet-500/30 bg-[#111118] p-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-violet-400">Glucose</span>
              {glucoseTrend && (
                <span className="text-[10px] text-zinc-500">
                  {dirArrow(glucoseTrend.direction as TrendDirection)} {glucoseTrend.direction} {glucoseTrend.streak > 0 && `${glucoseTrend.streak}d`}
                </span>
              )}
            </div>
            <div className="mt-2 flex items-baseline gap-3">
              <span className="text-3xl font-bold text-zinc-200">{summary.glucose?.average ?? "—"}</span>
              <span className="text-[11px] text-zinc-500">mmol/L avg</span>
              {glucoseTrend?.delta7dPct != null && (
                <span className={`text-[11px] ${deltaColor(glucoseTrend.delta7dPct)}`}>
                  {glucoseTrend.delta7dPct > 0 ? "+" : ""}{glucoseTrend.delta7dPct}% vs 7d
                </span>
              )}
              {glucoseTrend?.delta30dPct != null && (
                <span className="text-[11px] text-zinc-600">
                  {glucoseTrend.delta30dPct > 0 ? "+" : ""}{glucoseTrend.delta30dPct}% vs 30d
                </span>
              )}
            </div>
            {summary.glucose && (
              <div className="mt-2 grid grid-cols-4 gap-2 border-t border-zinc-800 pt-2">
                <div><div className="text-[9px] uppercase text-zinc-600">Min</div><div className="text-sm font-semibold text-zinc-200">{summary.glucose.min}</div></div>
                <div><div className="text-[9px] uppercase text-zinc-600">Max</div><div className="text-sm font-semibold text-zinc-200">{summary.glucose.max}</div></div>
                <div><div className="text-[9px] uppercase text-zinc-600">TIR</div><div className="text-sm font-semibold text-zinc-200">{Math.round((summary.glucose.estimatedTimeInRange ?? 0) * 100)}%</div></div>
                <div><div className="text-[9px] uppercase text-zinc-600">σ</div><div className="text-sm font-semibold text-zinc-200">{summary.glucose.variability}</div></div>
              </div>
            )}
          </div>

          {/* Vitals Table */}
          <div className="rounded-md border border-zinc-800 bg-[#111118] p-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-violet-400">Vitals & Activity</div>
            <div className="mt-2 space-y-0">
              {vitalTrends.length === 0 && <p className="text-zinc-600">Awaiting data…</p>}
              {vitalTrends.map((t) => (
                <div key={t.metric} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 border-b border-[#0a0a0f] px-1 py-1.5 hover:bg-[#1a1a2e]">
                  <span className="truncate text-zinc-400">{metricLabel(t.metric)}</span>
                  <span className="font-semibold tabular-nums text-zinc-200">{formatMetricValue(t.metric, t.value)}</span>
                  <span className={`min-w-[48px] text-right tabular-nums ${deltaColor(t.delta30dPct, INVERT_METRICS.has(t.metric))}`}>
                    {t.delta30dPct !== null ? `${t.delta30dPct > 0 ? "+" : ""}${t.delta30dPct}%` : "—"}
                  </span>
                  <span className="min-w-[40px] text-right text-zinc-500">
                    {dirArrow(t.direction as TrendDirection)} {t.streak > 0 ? `${t.streak}d` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* CENTER — Trends + Correlations */}
        <div className="flex flex-col gap-3">
          {/* Trend Narratives */}
          <div className="rounded-md border border-zinc-800 bg-[#111118] p-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-violet-400">Trend Narratives</span>
              <span className="text-[9px] text-zinc-600">7d + 30d baselines</span>
            </div>
            <div className="mt-2 space-y-1.5">
              {trends.length === 0 && <p className="text-zinc-600">Awaiting data…</p>}
              {trends.map((t) => {
                const dir = t.direction === "rising" ? "up" : t.direction === "falling" ? "down" : "stable at";
                const pct = t.delta7dPct !== null ? `${Math.abs(t.delta7dPct)}%` : "";
                const baseline = t.baseline7d !== null ? `${t.baseline7d}` : "";
                const streakNote = t.streak > 0 ? ` — ${t.direction} ${t.streak} consecutive days` : "";
                return (
                  <div key={t.metric} className={`border-l-2 ${narrativeSeverity(t)} py-1.5 pl-3 leading-relaxed text-zinc-300`}>
                    {metricLabel(t.metric)} {formatMetricValue(t.metric, t.value)}, {dir} {pct} from 7d baseline{baseline ? ` of ${baseline}` : ""}{streakNote}.
                  </div>
                );
              })}
            </div>
          </div>

          {/* Correlations */}
          <div className="rounded-md border border-zinc-800 bg-[#111118] p-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-violet-400">Glucose Correlations</span>
              <span className="text-[9px] text-zinc-600">30d · min 14 data points</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {correlations.length === 0 && <p className="col-span-2 text-zinc-600">Awaiting data…</p>}
              {[...sigCorrelations, ...pendingCorrelations].map((c) => (
                <div key={c.coFactorMetric} className={`rounded border ${c.significant === 1 ? "border-amber-500/30" : "border-zinc-800"} bg-[#0a0a0f] p-2.5`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-violet-300">{metricLabel(c.coFactorMetric)} → Glucose</span>
                    <span className={`text-[9px] rounded px-1.5 py-0.5 ${c.significant === 1 ? "bg-amber-500/10 text-amber-400" : "bg-zinc-800 text-zinc-500"}`}>
                      {c.significant === 1 ? "significant" : c.sampleCount >= 14 ? "not significant" : `${c.sampleCount}/14`}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    <div className="rounded bg-[#111118] p-2 text-center">
                      <span className="block text-[9px] text-zinc-500">&lt; {c.splitThreshold} {c.splitLabel}</span>
                      <span className="block text-lg font-bold text-zinc-200">{c.primaryWhenBelow?.toFixed(1) ?? "—"}</span>
                      <span className="block text-[9px] text-zinc-500">mmol/L</span>
                    </div>
                    <div className="rounded bg-[#111118] p-2 text-center">
                      <span className="block text-[9px] text-zinc-500">≥ {c.splitThreshold} {c.splitLabel}</span>
                      <span className="block text-lg font-bold text-zinc-200">{c.primaryWhenAbove?.toFixed(1) ?? "—"}</span>
                      <span className="block text-[9px] text-zinc-500">mmol/L</span>
                    </div>
                  </div>
                  <p className="mt-1.5 text-[10px] leading-snug text-zinc-400">{c.narrative}</p>
                  <p className="mt-1 text-[9px] text-zinc-600">n={c.sampleCount} · Δ {c.deltaAbs?.toFixed(1) ?? "—"} mmol/L</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT — Recovery + Insights + Log */}
        <div className="flex flex-col gap-3">
          {/* Recovery Snapshot */}
          <div className="rounded-md border border-zinc-800 bg-[#111118] p-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-violet-400">Recovery Snapshot</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {recoveryTrends.length === 0 && <p className="col-span-2 text-zinc-600">Awaiting data…</p>}
              {recoveryTrends.map((t) => (
                <div key={t.metric} className="rounded bg-[#0a0a0f] p-2.5 text-center">
                  <div className="text-[9px] uppercase text-zinc-600">{metricLabel(t.metric)}</div>
                  <div className={`text-xl font-bold ${deltaColor(t.delta30dPct, INVERT_METRICS.has(t.metric))}`}>
                    {formatMetricValue(t.metric, t.value)}
                  </div>
                  <div className={`text-[10px] ${deltaColor(t.delta30dPct, INVERT_METRICS.has(t.metric))}`}>
                    {dirArrow(t.direction as TrendDirection)} {t.delta30dPct !== null ? `${t.delta30dPct > 0 ? "+" : ""}${t.delta30dPct}% vs 30d` : "—"}
                  </div>
                  {t.streak > 0 && <div className="text-[9px] text-zinc-600">{t.streak}d {t.direction}</div>}
                </div>
              ))}
            </div>
          </div>

          {/* Insights */}
          <div className="flex-1 rounded-md border border-zinc-800 bg-[#111118] p-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-violet-400">Insights</span>
              <span className="text-[9px] text-zinc-600">{allInsights.length} active</span>
            </div>
            <div className="mt-2 space-y-0">
              {allInsights.length === 0 && <p className="text-zinc-600">No insights for this day.</p>}
              {allInsights.map((i) => {
                const dotColor = i.severity === "critical" ? "bg-red-500" : i.severity === "warning" ? "bg-amber-500" : i.severity === "notice" ? "bg-blue-400" : "bg-zinc-500";
                return (
                  <div key={i.id} className="grid grid-cols-[6px_1fr] gap-2 border-b border-[#0a0a0f] py-1.5">
                    <div className={`mt-1.5 h-1.5 w-1.5 rounded-full ${dotColor}`} />
                    <div>
                      <div className="font-mono text-[9px] text-zinc-600">{i.insightType}</div>
                      <div className="text-[11px] text-zinc-300">{i.title}</div>
                      <div className="text-[10px] text-zinc-500">{i.summary}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            {allInsights.length > 0 && (
              <Link href={`/insights?date=${date}`} className="mt-2 block text-[10px] text-zinc-500 underline underline-offset-2">all insights →</Link>
            )}
          </div>

          {/* Today's Log */}
          <div className="rounded-md border border-zinc-800 bg-[#111118] p-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-violet-400">Today&apos;s Log</div>
            <div className="mt-2 space-y-0">
              {annotations.length === 0 && <p className="text-zinc-600">No annotations.</p>}
              {annotations.map((e) => (
                <div key={e.id} className="grid grid-cols-[50px_60px_1fr] gap-2 border-b border-[#0a0a0f] py-1 text-[11px]">
                  <span className="text-zinc-600">{e.startedAt.toISOString().slice(11, 16)}</span>
                  <span className="font-medium text-violet-300">{(e.metadata as { annotationType?: string })?.annotationType ?? e.eventType}</span>
                  <span className="text-zinc-300">{e.title}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
