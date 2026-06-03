import { NextResponse } from "next/server";
import { getDexcomEnv } from "@/lib/connectors/dexcom-env";
import { exchangeCode } from "@/lib/connectors/dexcom-oauth";
import { upsertLiveDexcomConnection } from "@/lib/db/sources";
import { publicOrigin } from "@/lib/request-origin";

export const dynamic = "force-dynamic";

function back(request: Request, params: Record<string, string>): NextResponse {
  const qs = new URLSearchParams(params);
  return NextResponse.redirect(new URL(`/sources?${qs}`, publicOrigin(request)));
}

/** Read a single cookie value by exact name from a raw Cookie header. */
function readCookie(header: string | null, name: string): string | undefined {
  return header
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = readCookie(request.headers.get("cookie"), "dexcom_oauth_state");

  if (!code || !state || !cookieState || state !== cookieState) {
    return back(request, { dexcom_error: "bad_state" });
  }

  try {
    const creds = await exchangeCode(getDexcomEnv(), code, new Date());
    await upsertLiveDexcomConnection(creds);
  } catch (e) {
    console.error("[dexcom/callback] token exchange failed:", e);
    return back(request, { dexcom_error: "exchange_failed" });
  }

  const res = back(request, { dexcom: "connected" });
  res.cookies.delete("dexcom_oauth_state");
  return res;
}
