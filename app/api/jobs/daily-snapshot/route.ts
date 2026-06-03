import { NextResponse } from "next/server";
import { inngest } from "@/lib/inngest/client";
import { dayRange } from "@/lib/domain/time";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  try {
    dayRange(date);
  } catch {
    return NextResponse.json({ error: "invalid date (expected YYYY-MM-DD)" }, { status: 400 });
  }
  await inngest.send({ name: "snapshot/recompute.requested", data: { date } });
  return NextResponse.json({ ok: true, date }, { status: 202 });
}
