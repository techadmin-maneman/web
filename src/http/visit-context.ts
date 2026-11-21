// What a request from the site says of its visitor, for their touch (docs/decisions/0288-attribution-and-conversions.md):
// the visitor cookie the site's Worker gave, and the address and browser, kept for Meta's match alone.

import type { Context } from "hono";
import { visitorIn } from "../config/visitor-cookie.ts";
import type { VisitContext } from "../domain/attribution/lead-touch.ts";
import type { AppEnv } from "./context.ts";

const USER_AGENT_MAX = 500;

export function visitContextOf(c: Context<AppEnv>): VisitContext {
  return {
    visitorId: visitorIn(c.req.header("Host") ?? new URL(c.req.url).host, c.req.header("Cookie") ?? null),
    userAgent: c.req.header("User-Agent")?.slice(0, USER_AGENT_MAX) ?? null,
    clientIp: c.req.header("CF-Connecting-IP") ?? null,
  };
}
