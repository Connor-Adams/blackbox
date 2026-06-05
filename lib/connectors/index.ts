import type { Connector } from "./types";
import { dexcomConnector } from "./dexcom";
import { cashflowConnector } from "./cashflow";
import { garminConnector } from "./garmin";

const REGISTRY: Partial<Record<string, Connector>> = {
  dexcom: dexcomConnector,
  cashflow: cashflowConnector,
  garmin: garminConnector,
};

/** The connector for a source type, or null (e.g. `manual` is UI-driven). */
export function getConnector(sourceType: string): Connector | null {
  return REGISTRY[sourceType] ?? null;
}
