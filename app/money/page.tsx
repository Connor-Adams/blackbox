import { getCashflowDashboard } from "@/lib/connectors/cashflow-dashboard";
import { getCashflowTimelineEvents } from "@/lib/db/finance";
import { pickTransactions } from "@/lib/domain/finance";
import { SEED_USER_ID } from "@/lib/constants";
import { FinanceView } from "@/components/money/FinanceView";

export const dynamic = "force-dynamic";

export default async function MoneyPage() {
  const [dashboard, txns] = await Promise.all([
    getCashflowDashboard(),
    getCashflowTimelineEvents(SEED_USER_ID, 90),
  ]);
  const { recent, largest } = pickTransactions(txns, { recentLimit: 10, largestLimit: 10 });
  return <FinanceView dashboard={dashboard} recent={recent} largest={largest} />;
}
