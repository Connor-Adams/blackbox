import { getDb } from "@/lib/db/client";
import { DbIngestStore, ensureSourceConnection } from "@/lib/db/store";
import { ingestRawEvents } from "@/lib/domain/ingest";
import {
  SEED_MANUAL_CONNECTION_ID,
  SEED_DEXCOM_CONNECTION_ID,
} from "@/lib/constants";
import { glucoseNormalDay, glucoseVolatileDay, manualNotesDay } from "@/lib/mock/data";

async function main() {
  void getDb(); // fail fast if DATABASE_URL is missing
  const store = new DbIngestStore();

  const dexcom = await ensureSourceConnection({ id: SEED_DEXCOM_CONNECTION_ID, sourceType: "dexcom", displayName: "Dexcom (mock)" });
  const manual = await ensureSourceConnection({ id: SEED_MANUAL_CONNECTION_ID, sourceType: "manual", displayName: "Manual log" });

  const dexResult = await ingestRawEvents(store, dexcom, [...glucoseNormalDay, ...glucoseVolatileDay]);
  const manResult = await ingestRawEvents(store, manual, manualNotesDay);

  console.log("Seed complete:", { dexcom: dexResult, manual: manResult });
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
