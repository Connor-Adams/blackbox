import { NextResponse } from "next/server";
import { getDexcomEnv } from "@/lib/connectors/dexcom-env";
import { exchangeCode } from "@/lib/connectors/dexcom-oauth";
import { upsertLiveDexcomConnection } from "@/lib/db/sources";

export const dynamic = "force-dynamic";

function back(request: Request, error?: string): NextResponse {
  const path = error ? `/sources?dexcom_error=${error}` : "/sources?dexcom=connected";
  return NextResponse.redirect(new URL(path, request.url));
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = request.headers.get("cookie")?.match(/dexcom_oauth_state=([^;]+)/)?.[1];

  if (!code || !state || !cookieState || state !== cookieState) {
    return back(request, "bad_state");
  }

  try {
    const creds = await exchangeCode(getDexcomEnv(), code, new Date());
    await upsertLiveDexcomConnection(creds);
  } catch {
    return back(request, "exchange_failed");
  }

  const res = back(request);
  res.cookies.delete("dexcom_oauth_state");
  return res;
}
