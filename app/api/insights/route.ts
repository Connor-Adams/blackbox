import { NextResponse } from "next/server";
import { getInsights, computeAndStoreInsights } from "@/lib/db/insights";
import { serializeInsights } from "@/lib/api/insight-dto";
import { SEED_USER_ID } from "@/lib/constants";
import { dayRange } from "@/lib/domain/time";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? "2026-06-01";
  try {
    dayRange(date);
  } catch {
    return NextResponse.json({ error: "invalid date (expected YYYY-MM-DD)" }, { status: 400 });
  }
  let rows = await getInsights(SEED_USER_ID, date);
  if (rows.length === 0) {
    await computeAndStoreInsights(SEED_USER_ID, date);
    rows = await getInsights(SEED_USER_ID, date);
  }
  return NextResponse.json({ date, insights: serializeInsights(rows) });
}
