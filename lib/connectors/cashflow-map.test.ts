import { describe, it, expect } from "vitest";
import { mapCashflowTransaction } from "./cashflow-map";

describe("mapCashflowTransaction", () => {
  it("negates amount for a spend (negative input → positive output)", () => {
    const result = mapCashflowTransaction({
      id: 1,
      date: "2026-05-15",
      merchant: "Coffee Shop",
      amount: -42,
    });
    expect(result.amount).toBe(42);
  });

  it("negates amount for income (positive input → negative output)", () => {
    const result = mapCashflowTransaction({
      id: 2,
      date: "2026-05-15",
      amount: 1000,
    });
    expect(result.amount).toBe(-1000);
  });

  it("prefers merchant over description for description field", () => {
    const result = mapCashflowTransaction({
      id: 3,
      date: "2026-05-15",
      merchant: "Whole Foods",
      description: "POS Purchase",
      amount: -55,
    });
    expect(result.description).toBe("Whole Foods");
  });

  it("falls back to description when merchant is absent", () => {
    const result = mapCashflowTransaction({
      id: 4,
      date: "2026-05-15",
      description: "POS Purchase",
      amount: -30,
    });
    expect(result.description).toBe("POS Purchase");
  });

  it("falls back to txn <id> when both merchant and description are absent", () => {
    const result = mapCashflowTransaction({
      id: 5,
      date: "2026-05-15",
      amount: -10,
    });
    expect(result.description).toBe("txn 5");
  });

  it("maps category null to undefined", () => {
    const result = mapCashflowTransaction({
      id: 6,
      date: "2026-05-15",
      amount: -20,
      category: null,
    });
    expect(result.category).toBeUndefined();
  });

  it("passes through a non-null category", () => {
    const result = mapCashflowTransaction({
      id: 7,
      date: "2026-05-15",
      amount: -20,
      category: "groceries",
    });
    expect(result.category).toBe("groceries");
  });

  it("converts date to midday UTC timestamp", () => {
    const result = mapCashflowTransaction({
      id: 8,
      date: "2026-05-15",
      amount: -10,
    });
    expect(result.timestamp).toBe("2026-05-15T12:00:00Z");
  });

  it("sets recordId to string of id", () => {
    const result = mapCashflowTransaction({
      id: 42,
      date: "2026-05-15",
      amount: -10,
    });
    expect(result.recordId).toBe("42");
  });
});
