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
  const today = new Date().toISOString().slice(0, 10);
  let date = rawDate ?? today;
  try {
    dayRange(date);
  } catch {
    date = today;
  }
  const data = await getTimeline(SEED_USER_ID, date);
  const timeline = serializeTimeline(date, data);
  return <TimelineView timeline={timeline} />;
}
