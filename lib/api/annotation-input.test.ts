import { describe, it, expect } from "vitest";
import { parseAnnotationInput } from "@/lib/api/annotation-input";

describe("parseAnnotationInput", () => {
  it("accepts a valid annotation", () => {
    const a = parseAnnotationInput({ type: "meal", title: "Lunch", timestamp: "2026-06-01T12:00:00Z", notes: "x" });
    expect(a.type).toBe("meal");
    expect(a.title).toBe("Lunch");
  });
  it("rejects an unknown type", () => {
    expect(() => parseAnnotationInput({ type: "party", title: "x", timestamp: "2026-06-01T12:00:00Z" })).toThrow();
  });
  it("rejects an empty title", () => {
    expect(() => parseAnnotationInput({ type: "note", title: "", timestamp: "2026-06-01T12:00:00Z" })).toThrow();
  });
  it("rejects a bad timestamp", () => {
    expect(() => parseAnnotationInput({ type: "note", title: "x", timestamp: "nope" })).toThrow();
  });
});
