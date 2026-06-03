import type { DexcomEnv } from "./dexcom-env";
import type { DexcomCreds } from "./types";

type FetchImpl = typeof fetch;

interface DexcomTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}

/** ISO timestamp `seconds` after `now`. */
export function tokenExpiryFrom(seconds: number, now: Date): string {
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

/** The Dexcom consent URL to redirect the user to. */
export function buildAuthorizeUrl(env: DexcomEnv, state: string): string {
  const url = new URL(`${env.apiBase}/v2/oauth2/login`);
  url.searchParams.set("client_id", env.clientId);
  url.searchParams.set("redirect_uri", env.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "offline_access");
  url.searchParams.set("state", state);
  return url.toString();
}

async function postToken(
  env: DexcomEnv,
  params: Record<string, string>,
  now: Date,
  fetchImpl: FetchImpl,
): Promise<DexcomCreds> {
  const body = new URLSearchParams({
    client_id: env.clientId,
    client_secret: env.clientSecret,
    redirect_uri: env.redirectUri,
    ...params,
  });
  const res = await fetchImpl(`${env.apiBase}/v2/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`dexcom token exchange failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as DexcomTokenResponse;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: tokenExpiryFrom(json.expires_in, now),
    scope: json.scope,
    apiBase: env.apiBase,
  };
}

/** Exchange an authorization code for the initial credentials. */
export function exchangeCode(
  env: DexcomEnv,
  code: string,
  now: Date,
  fetchImpl: FetchImpl = fetch,
): Promise<DexcomCreds> {
  return postToken(env, { grant_type: "authorization_code", code }, now, fetchImpl);
}

/** Exchange a refresh token for rotated credentials. */
export function refresh(
  env: DexcomEnv,
  refreshToken: string,
  now: Date,
  fetchImpl: FetchImpl = fetch,
): Promise<DexcomCreds> {
  return postToken(env, { grant_type: "refresh_token", refresh_token: refreshToken }, now, fetchImpl);
}
