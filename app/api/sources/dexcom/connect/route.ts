import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDexcomEnv, isDexcomLive } from "@/lib/connectors/dexcom-env";
import { buildAuthorizeUrl } from "@/lib/connectors/dexcom-oauth";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDexcomLive()) {
    return NextResponse.redirect(new URL("/sources?dexcom_error=not_configured", request.url));
  }
  const state = randomUUID();
  const res = NextResponse.redirect(buildAuthorizeUrl(getDexcomEnv(), state));
  res.cookies.set("dexcom_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
