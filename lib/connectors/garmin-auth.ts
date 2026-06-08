/**
 * Garmin authed HTTP for the connector's sync path.
 *
 * Post-auth data fetches go through the lib's internal axios HttpClient
 * (deep-imported), which auto-refreshes the OAuth2 token from the persisted
 * session bundle — so arbitrary connectapi.garmin.com endpoints are replayable
 * with just the stored creds, no re-login until the refresh token expires (~1yr).
 *
 * NB: this module deliberately does NOT import the package index
 * (`garmin-connect-client`), which would transitively load the native JA3 curl
 * transport (node-libcurl-ja3). That transport is only needed for the SSO
 * *login* handshake (see scripts/garmin-login.ts) — not for syncing. Keeping it
 * out of the connector path means the deployed server carries no native
 * dependency and never has to load the binding at runtime.
 */
// Deep imports — the package ships no "exports" map, so internal modules resolve.
import { HttpClient } from "garmin-connect-client/dist/http-client.js";
import { GarminUrls } from "garmin-connect-client/dist/urls.js";
import type { GarminCreds } from "./types";

/** Minimal authed GET surface — lets the fetch layer be tested without network. */
export interface GarminHttp {
  get<T>(url: string): Promise<T>;
}

/** Build an auto-refreshing authed HTTP client from a stored session bundle. */
export function httpFromCreds(creds: GarminCreds): GarminHttp {
  return new HttpClient(new GarminUrls(), creds as never) as unknown as GarminHttp;
}
