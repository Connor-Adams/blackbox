import { LIVE_DEXCOM_CONNECTION_ID } from "@/lib/constants";

/** Source types that support an OAuth connect flow, and where it starts. */
export const CONNECTABLE = {
  dexcom: { authStartUrl: "/api/sources/dexcom/connect", label: "Connect Dexcom" },
} as const;

/** Show the Dexcom connect button when live creds exist and no live connection has been made. */
export function dexcomConnectAvailable(isLive: boolean, sources: { id: string }[]): boolean {
  if (!isLive) return false;
  return !sources.some((s) => s.id === LIVE_DEXCOM_CONNECTION_ID);
}
