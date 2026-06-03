import type { Connector } from "./types";
import { glucoseNormalDay, glucoseVolatileDay } from "@/lib/mock/data";

/** Mock Dexcom connector — emits the seeded glucose readings. */
export const dexcomConnector: Connector = {
  sourceType: "dexcom",
  async sync() {
    return [...glucoseNormalDay, ...glucoseVolatileDay];
  },
};
