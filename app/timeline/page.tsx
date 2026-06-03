import { getTimeline } from "@/lib/db/store";
import { serializeTimeline } from "@/lib/api/timeline-dto";
import { SEED_USER_ID } from "@/lib/constants";
import { dayRange } from "@/lib/domain/time";
import { TimelineView } from "@/components/timeline/TimelineView";

export const dynamic = "force-dynamic";

export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: rawDate } = await searchParams;
  let date = rawDate ?? "2026-06-01";
  try {
    dayRange(date);
  } catch {
    date = "2026-06-01";
  }
  const data = await getTimeline(SEED_USER_ID, date);
  const timeline = serializeTimeline(date, data);
  return <TimelineView timeline={timeline} />;
}
