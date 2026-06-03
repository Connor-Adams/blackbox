import type { insight } from "@/lib/db/schema";

type InsightRow = typeof insight.$inferSelect;

export interface InsightDTO {
  id: string;
  insightType: string;
  severity: string;
  title: string;
  summary: string;
  evidence: Record<string, unknown>;
  sourceObservationIds: string[];
  sourceTimelineEventIds: string[];
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, notice: 2, info: 3 };

/** Active insights only, ordered by severity (critical first). Pure. */
export function serializeInsights(rows: InsightRow[]): InsightDTO[] {
  return rows
    .filter((r) => r.status === "active")
    .slice()
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9))
    .map((r) => ({
      id: r.id,
      insightType: r.insightType,
      severity: r.severity,
      title: r.title,
      summary: r.summary,
      evidence: r.evidenceJson ?? {},
      sourceObservationIds: r.sourceObservationIds ?? [],
      sourceTimelineEventIds: r.sourceTimelineEventIds ?? [],
    }));
}
