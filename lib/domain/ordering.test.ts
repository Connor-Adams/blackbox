import { describe, it, expect } from "vitest";
import { orderTimeline } from "@/lib/domain/ordering";

describe("orderTimeline", () => {
  it("sorts events chronologically by startedAt", () => {
    const events = [
      { startedAt: new Date("2026-06-01T12:00:00Z"), title: "b" },
      { startedAt: new Date("2026-06-01T08:00:00Z"), title: "a" },
      { startedAt: new Date("2026-06-01T20:00:00Z"), title: "c" },
    ];
    expect(orderTimeline(events).map((e) => e.title)).toEqual(["a", "b", "c"]);
  });

  it("is stable for equal timestamps (preserves input order)", () => {
    const t = new Date("2026-06-01T09:00:00Z");
    const events = [
      { startedAt: t, title: "first" },
      { startedAt: t, title: "second" },
    ];
    expect(orderTimeline(events).map((e) => e.title)).toEqual(["first", "second"]);
  });

  it("does not mutate the input array", () => {
    const events = [
      { startedAt: new Date("2026-06-01T12:00:00Z"), title: "b" },
      { startedAt: new Date("2026-06-01T08:00:00Z"), title: "a" },
    ];
    orderTimeline(events);
    expect(events.map((e) => e.title)).toEqual(["b", "a"]);
  });
});
