import { getDb } from "@/lib/db/client";
import { sql } from "drizzle-orm";

async function main() {
  const db = getDb();
  await db.execute(sql`TRUNCATE TABLE insight, daily_snapshot, observation, timeline_event, annotation, raw_event, import_batch, source_connection RESTART IDENTITY CASCADE`);
  console.log("Reset complete: all data tables truncated.");
  process.exit(0);
}
main().catch((e) => { console.error("Reset failed:", e); process.exit(1); });
