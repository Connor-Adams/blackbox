import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

// postgres.js connection. `prepare: false` keeps it compatible with
// connection poolers; safe for Railway's managed Postgres.
const queryClient = postgres(env().DATABASE_URL, { prepare: false });

export const db = drizzle(queryClient, { schema });
