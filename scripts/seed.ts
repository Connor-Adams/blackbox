import { getDb } from "@/lib/db/client";
import { sourceConnection } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { DbIngestStore } from "@/lib/db/store";
import { ingestRawEvents, type IngestConnection } from "@/lib/domain/ingest";
import {
  SEED_USER_ID,
  SEED_MANUAL_CONNECTION_ID,
  SEED_DEXCOM_CONNECTION_ID,
} from "@/lib/constants";
import { glucoseNormalDay, glucoseVolatileDay, manualNotesDay } from "@/lib/mock/data";

async function ensureConnection(conn: {
  id: string;
  sourceType: IngestConnection["sourceType"];
  displayName: string;
}): Promise<IngestConnection> {
  const db = getDb();
  const [existing] = await db
    .select({ id: sourceConnection.id })
    .from(sourceConnection)
    .where(eq(sourceConnection.id, conn.id))
    .limit(1);
  if (!existing) {
    await db.insert(sourceConnection).values({
      id: conn.id,
      userId: SEED_USER_ID,
      sourceType: conn.sourceType,
      displayName: conn.displayName,
      status: "active",
    });
  }
  return { id: conn.id, userId: SEED_USER_ID, sourceType: conn.sourceType };
}

async function main() {
  const store = new DbIngestStore();

  const dexcom = await ensureConnection({
    id: SEED_DEXCOM_CONNECTION_ID,
    sourceType: "dexcom",
    displayName: "Dexcom (mock)",
  });
  const manual = await ensureConnection({
    id: SEED_MANUAL_CONNECTION_ID,
    sourceType: "manual",
    displayName: "Manual log",
  });

  const dexResult = await ingestRawEvents(store, dexcom, [...glucoseNormalDay, ...glucoseVolatileDay]);
  const manResult = await ingestRawEvents(store, manual, manualNotesDay);

  console.log("Seed complete:", { dexcom: dexResult, manual: manResult });
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
