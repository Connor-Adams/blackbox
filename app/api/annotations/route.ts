import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { parseAnnotationInput } from "@/lib/api/annotation-input";
import { createAnnotation } from "@/lib/db/annotations";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  let input;
  try {
    input = parseAnnotationInput(body);
  } catch (error) {
    const message = error instanceof ZodError ? error.issues : String(error);
    return NextResponse.json({ error: "validation failed", detail: message }, { status: 400 });
  }
  const created = await createAnnotation(input);
  return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
}
