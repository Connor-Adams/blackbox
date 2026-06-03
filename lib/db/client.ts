import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

function createDb() {
  // postgres.js connection. `prepare: false` keeps it compatible with
  // connection poolers; safe for Railway's managed Postgres.
  const client = postgres(env().DATABASE_URL, { prepare: false });
  return drizzle(client, { schema });
}

let cached: ReturnType<typeof createDb> | null = null;

/** Lazy singleton — the connection (and env validation) is created on first use, not at import time. */
export function getDb() {
  return (cached ??= createDb());
}
