export interface DexcomEnv {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  apiBase: string;
}

type Source = Record<string, string | undefined>;

const SANDBOX_BASE = "https://sandbox-api.dexcom.com";

/** Read Dexcom env. Pass a source object (defaults to process.env). */
export function getDexcomEnv(src: Source = process.env): DexcomEnv {
  return {
    clientId: src.DEXCOM_CLIENT_ID ?? "",
    clientSecret: src.DEXCOM_CLIENT_SECRET ?? "",
    redirectUri: src.DEXCOM_REDIRECT_URI ?? "",
    apiBase: src.DEXCOM_API_BASE || SANDBOX_BASE,
  };
}

/** True when all client credentials are configured (live mode available). */
export function isDexcomLive(src: Source = process.env): boolean {
  const e = getDexcomEnv(src);
  return Boolean(e.clientId && e.clientSecret && e.redirectUri);
}
