import { ensureSourceConnection } from "@/lib/db/store";
import { runConnectorSync } from "@/lib/db/sources";
import { SEED_CASHFLOW_CONNECTION_ID } from "@/lib/constants";

async function main() {
  const conn = await ensureSourceConnection({ id: SEED_CASHFLOW_CONNECTION_ID, sourceType: "cashflow", displayName: "Cashflow" });
  const result = await runConnectorSync(conn.id);
  console.log("Cashflow sync:", result);
  process.exit(result.ok ? 0 : 1);
}
main().catch((e) => { console.error("Sync failed:", e); process.exit(1); });
