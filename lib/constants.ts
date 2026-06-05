// Single-user v0: a fixed user id used server-side until auth lands.
// Valid UUID (version 4, variant 8) so it satisfies uuid columns.
export const SEED_USER_ID = "00000000-0000-4000-8000-000000000001";

// Fixed ids for the seed source connections, so re-seeding is idempotent.
export const SEED_MANUAL_CONNECTION_ID = "00000000-0000-4000-8000-000000000010";
export const SEED_DEXCOM_CONNECTION_ID = "00000000-0000-4000-8000-000000000011";
export const SEED_CASHFLOW_CONNECTION_ID = "00000000-0000-4000-8000-000000000012";

// Fixed id for the live (OAuth-connected) Dexcom connection, distinct from the
// mock seed connection so live data and mock demo data coexist.
export const LIVE_DEXCOM_CONNECTION_ID = "00000000-0000-4000-8000-000000000020";

export const SEED_GARMIN_CONNECTION_ID = "00000000-0000-4000-8000-000000000013";
export const LIVE_GARMIN_CONNECTION_ID = "00000000-0000-4000-8000-000000000021";
