import { NextResponse } from "next/server";
import { runConnectorSync } from "@/lib/db/sources";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await runConnectorSync(id);
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result, { status: 202 });
}
