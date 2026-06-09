import { NextResponse } from "next/server";
import { dayRange } from "@/lib/domain/time";
import { computeAndStoreTrends } from "@/lib/db/trends";
import { SEED_USER_ID } from "@/lib/constants";

export const dynamic = "force-dynamic";

/** Recompute + persist trend records synchronously (idempotent upsert).
 *  Synchronous so a cron/trigger actually runs it — there is no Inngest worker
 *  in this deployment. `?date=YYYY-MM-DD` (defaults to today, UTC). */
export async function POST(request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  try {
    dayRange(date);
  } catch {
    return NextResponse.json({ error: "invalid date (expected YYYY-MM-DD)" }, { status: 400 });
  }
  const count = await computeAndStoreTrends(SEED_USER_ID, date);
  return NextResponse.json({ ok: true, date, count });
}
