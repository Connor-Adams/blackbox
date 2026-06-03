import { NextResponse } from "next/server";
import { getTimeline } from "@/lib/db/store";
import { serializeTimeline } from "@/lib/api/timeline-dto";
import { SEED_USER_ID } from "@/lib/constants";
import { dayRange } from "@/lib/domain/time";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  try {
    dayRange(date);
  } catch {
    return NextResponse.json({ error: "invalid date (expected YYYY-MM-DD)" }, { status: 400 });
  }
  const data = await getTimeline(SEED_USER_ID, date);
  return NextResponse.json(serializeTimeline(date, data));
}
