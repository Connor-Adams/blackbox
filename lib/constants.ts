// Single-user v0: a fixed user id used server-side until auth lands.
// Valid UUID (version 4, variant 8) so it satisfies uuid columns.
export const SEED_USER_ID = "00000000-0000-4000-8000-000000000001";

// Fixed ids for the seed source connections, so re-seeding is idempotent.
export const SEED_MANUAL_CONNECTION_ID = "00000000-0000-4000-8000-000000000010";
export const SEED_DEXCOM_CONNECTION_ID = "00000000-0000-4000-8000-000000000011";
