import { NextResponse } from "next/server";
import { dismissInsight } from "@/lib/db/insights";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }
  await dismissInsight(id);
  return NextResponse.json({ ok: true, id });
}
