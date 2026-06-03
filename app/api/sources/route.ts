import { NextResponse } from "next/server";
import { listSourceConnections } from "@/lib/db/sources";
import { serializeSources } from "@/lib/api/source-dto";
import { SEED_USER_ID } from "@/lib/constants";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await listSourceConnections(SEED_USER_ID);
  return NextResponse.json({ sources: serializeSources(rows) });
}
