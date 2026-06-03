import { describe, it, expect } from "vitest";
import { computeDailySnapshot } from "@/lib/domain/snapshot";

const obs = (metric: string, value: number) => ({ metric, value });
const manual = (annotationType: string) => ({ sourceType: "manual", metadata: { annotationType } });

describe("computeDailySnapshot", () => {
  it("returns an empty summary for no data", () => {
    expect(computeDailySnapshot({ observations: [], timelineEvents: [] })).toEqual({});
  });

  it("computes glucose stats (count/avg/min/max/variability/TIR)", () => {
    const s = computeDailySnapshot({
      observations: [obs("glucose", 5), obs("glucose", 7), obs("glucose", 12), obs("glucose", 3)],
      timelineEvents: [],
    });
    expect(s.glucose).toBeDefined();
    expect(s.glucose!.readingCount).toBe(4);
    expect(s.glucose!.average).toBe(6.75);
    expect(s.glucose!.min).toBe(3);
    expect(s.glucose!.max).toBe(12);
    expect(s.glucose!.variability).toBeCloseTo(3.34, 1);
    expect(s.glucose!.estimatedTimeInRange).toBe(0.5);
  });

  it("ignores non-glucose observations for the glucose section", () => {
    const s = computeDailySnapshot({ observations: [obs("cash_balance", 100)], timelineEvents: [] });
    expect(s.glucose).toBeUndefined();
  });

  it("computes finance from transaction_amount observations", () => {
    const s = computeDailySnapshot({
      observations: [obs("transaction_amount", 12.5), obs("transaction_amount", 40)],
      timelineEvents: [],
    });
    expect(s.finance).toEqual({ spendTotal: 52.5, transactionCount: 2, largestTransaction: 40 });
  });

  it("tallies manual annotations by type", () => {
    const s = computeDailySnapshot({
      observations: [],
      timelineEvents: [manual("meal"), manual("meal"), manual("insulin"), { sourceType: "dexcom", metadata: {} }],
    });
    expect(s.annotations).toEqual({ count: 3, types: { meal: 2, insulin: 1 } });
  });
});
