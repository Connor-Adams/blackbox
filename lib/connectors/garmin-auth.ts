/**
 * Garmin auth wrapper around garmin-connect-client.
 *
 * Login uses the lib's device-identity (diauth) OAuth2 flow over its JA3 curl
 * transport; the returned PersistedSession bundle ({cookies, oauth2Token,
 * diClientId}) is our GarminCreds. Post-auth data fetches go through the lib's
 * internal axios HttpClient (deep-imported), which auto-refreshes the OAuth2
 * token — so arbitrary connectapi.garmin.com endpoints are replayable with just
 * the persisted bundle (no re-login until the refresh token expires, ~1yr).
 */
import { login as gccLogin } from "garmin-connect-client";
// Deep imports — the package ships no "exports" map, so internal modules resolve.
import { HttpClient } from "garmin-connect-client/dist/http-client.js";
import { GarminUrls } from "garmin-connect-client/dist/urls.js";
import type { GarminCreds } from "./types";

/** Minimal authed GET surface — lets the fetch layer be tested without network. */
export interface GarminHttp {
  get<T>(url: string): Promise<T>;
}

/** Log in with credentials and return the persistable session bundle.
 *  `mfaCode` is called only if the account requires 2FA. */
export async function loginGarmin(
  email: string,
  password: string,
  mfaCode?: () => Promise<string>,
): Promise<GarminCreds> {
  const result = await gccLogin({ username: email, password });
  if (result.mfaRequired) {
    if (!mfaCode) throw new Error("garmin: account requires a 2FA code, but none was provided");
    const client = await gccLogin(result, await mfaCode());
    return client.getSession() as unknown as GarminCreds;
  }
  return result.client.getSession() as unknown as GarminCreds;
}

/** Build an auto-refreshing authed HTTP client from a stored session bundle. */
export function httpFromCreds(creds: GarminCreds): GarminHttp {
  return new HttpClient(new GarminUrls(), creds as never) as unknown as GarminHttp;
}
