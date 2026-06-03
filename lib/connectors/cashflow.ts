import type { Connector } from "./types";
import { cashflowDay } from "@/lib/mock/data";

/** Mock Cashflow connector — emits read-only transaction payloads. */
export const cashflowConnector: Connector = {
  sourceType: "cashflow",
  async sync() {
    return cashflowDay;
  },
};
