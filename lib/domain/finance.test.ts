import { describe, it, expect } from "vitest";
import { pickTransactions, type FinanceTxn } from "@/lib/domain/finance";

const t = (id: string, amount: number, iso: string): FinanceTxn => ({ id, title: `txn ${id}`, amount, timestamp: iso, category: null });

describe("pickTransactions", () => {
  const txns = [t("a", 10, "2026-06-01T12:00:00Z"), t("b", 200, "2026-05-20T12:00:00Z"), t("c", 35, "2026-06-03T12:00:00Z"), t("d", 5, "2026-04-10T12:00:00Z")];
  it("recent is sorted by timestamp desc, limited", () => {
    expect(pickTransactions(txns, { recentLimit: 2, largestLimit: 2 }).recent.map((x) => x.id)).toEqual(["c", "a"]);
  });
  it("largest is sorted by amount desc, limited", () => {
    expect(pickTransactions(txns, { recentLimit: 2, largestLimit: 2 }).largest.map((x) => x.id)).toEqual(["b", "c"]);
  });
  it("does not mutate the input", () => {
    pickTransactions(txns, { recentLimit: 2, largestLimit: 2 });
    expect(txns.map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
  });
});
