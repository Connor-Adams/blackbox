import { describe, it, expect } from "vitest";
import { serializeInsights } from "@/lib/api/insight-dto";

const row = (over: Partial<Record<string, unknown>>) => ({
  id: "i1", userId: "u", date: "2026-06-01", timeRangeStart: new Date("2026-06-01T00:00:00Z"),
  timeRangeEnd: new Date("2026-06-02T00:00:00Z"), insightType: "glucose_high", severity: "warning",
  title: "Glucose spike", summary: "…", evidenceJson: { max: 14 }, sourceObservationIds: ["o1"],
  sourceTimelineEventIds: [], status: "active", createdAt: new Date("2026-06-01T01:00:00Z"), ...over,
});

describe("serializeInsights", () => {
  it("drops dismissed/archived and orders by severity (critical first)", () => {
    const out = serializeInsights([
      row({ id: "warn", severity: "warning" }),
      row({ id: "crit", severity: "critical" }),
      row({ id: "gone", status: "dismissed" }),
      row({ id: "info", severity: "info" }),
    ] as never);
    expect(out.map((i) => i.id)).toEqual(["crit", "warn", "info"]);
  });

  it("serializes evidence + source ids", () => {
    const [i] = serializeInsights([row({})] as never);
    expect(i.evidence).toEqual({ max: 14 });
    expect(i.sourceObservationIds).toEqual(["o1"]);
    expect(i.severity).toBe("warning");
  });
});
