import { getInsights, computeAndStoreInsights } from "@/lib/db/insights";
import { serializeInsights } from "@/lib/api/insight-dto";
import { SEED_USER_ID } from "@/lib/constants";
import { dayRange } from "@/lib/domain/time";
import { InsightsView } from "@/components/insights/InsightsView";

export const dynamic = "force-dynamic";

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: rawDate } = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  let date = rawDate ?? today;
  try {
    dayRange(date);
  } catch {
    date = today;
  }

  let rows = await getInsights(SEED_USER_ID, date);
  if (rows.length === 0) {
    await computeAndStoreInsights(SEED_USER_ID, date);
    rows = await getInsights(SEED_USER_ID, date);
  }
  return <InsightsView date={date} insights={serializeInsights(rows)} />;
}
