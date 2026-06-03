/** The app's public origin, for building absolute redirect URLs in route
 *  handlers. Behind a proxy (e.g. Railway), `request.url` is the container's
 *  internal address (localhost:PORT), so redirects built from it escape the
 *  public domain. Resolve order:
 *    1. BLACKBOX_APP_URL — explicit, proxy-proof, not spoofable
 *    2. x-forwarded-host (+ x-forwarded-proto) — set by the host proxy
 *    3. the request's own origin — local dev with no proxy
 */
export function publicOrigin(request: Request): string {
  const configured = process.env.BLACKBOX_APP_URL;
  if (configured) return new URL(configured).origin;

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host}`;
  }

  return new URL(request.url).origin;
}
