// The site's visitor cookie (docs/decisions/0288-attribution-and-conversions.md): set by the site's Worker on the first
// page a browser asks for, read by the API on the requests that page makes. It names one visitor for 13 months. It is
// set on maneman.in, so the client app's host sends it too, and each environment has its own name, since staging's
// hosts are under maneman.in as well.

/** 13 months, in seconds. */
export const VISITOR_COOKIE_SECONDS = 396 * 24 * 60 * 60;

/** A visitor's ID, as the Worker writes it: a UUID. */
export const VISITOR_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The cookie's name, and the domain it is set on, for a request's host: none on localhost. */
export function visitorCookieOf(host: string): { readonly name: string; readonly domain: string | null } {
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  if (hostname !== "maneman.in" && !hostname.endsWith(".maneman.in")) return { name: "mm_vid_local", domain: null };
  return { name: hostname.includes("staging") ? "mm_vid_staging" : "mm_vid", domain: "maneman.in" };
}

/** The visitor a request's cookies name, or null. */
export function visitorIn(host: string, cookies: string | null): string | null {
  const { name } = visitorCookieOf(host);
  for (const pair of (cookies ?? "").split(";")) {
    const [key, value] = pair.trim().split("=");
    if (key === name && value !== undefined && VISITOR_ID_PATTERN.test(value)) return value;
  }
  return null;
}

/** The Set-Cookie header that gives the browser a visitor. */
export function visitorCookieHeader(host: string, visitorId: string): string {
  const { name, domain } = visitorCookieOf(host);
  const parts = [`${name}=${visitorId}`, `Max-Age=${String(VISITOR_COOKIE_SECONDS)}`, "Path=/", "SameSite=Lax"];
  if (domain !== null) parts.push(`Domain=${domain}`, "Secure");
  parts.push("HttpOnly");
  return parts.join("; ");
}
