import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  // DB ping only when configured (skipped in environments without DATABASE_URL).
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ status: "ok", db: "unconfigured" });
  }
  try {
    const { getDb } = await import("@/lib/db/client");
    const { sql } = await import("drizzle-orm");
    await getDb().execute(sql`select 1`);
    return NextResponse.json({ status: "ok", db: "up" });
  } catch (error) {
    return NextResponse.json(
      { status: "degraded", db: "down", error: String(error) },
      { status: 503 },
    );
  }
}
