import { getDb } from "@/lib/db/client";
import { DbIngestStore, ensureSourceConnection } from "@/lib/db/store";
import { ingestRawEvents } from "@/lib/domain/ingest";
import {
  SEED_MANUAL_CONNECTION_ID,
  SEED_DEXCOM_CONNECTION_ID,
  SEED_CASHFLOW_CONNECTION_ID,
} from "@/lib/constants";
import { glucoseNormalDay, glucoseVolatileDay, manualNotesDay, cashflowDay } from "@/lib/mock/data";

async function main() {
  void getDb();
  const store = new DbIngestStore();

  const dexcom = await ensureSourceConnection({ id: SEED_DEXCOM_CONNECTION_ID, sourceType: "dexcom", displayName: "Dexcom (mock)" });
  const manual = await ensureSourceConnection({ id: SEED_MANUAL_CONNECTION_ID, sourceType: "manual", displayName: "Manual log" });
  const cashflow = await ensureSourceConnection({ id: SEED_CASHFLOW_CONNECTION_ID, sourceType: "cashflow", displayName: "Cashflow (mock)" });

  const dexResult = await ingestRawEvents(store, dexcom, [...glucoseNormalDay, ...glucoseVolatileDay]);
  const manResult = await ingestRawEvents(store, manual, manualNotesDay);
  const cashResult = await ingestRawEvents(store, cashflow, cashflowDay);

  console.log("Seed complete:", { dexcom: dexResult, manual: manResult, cashflow: cashResult });
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
