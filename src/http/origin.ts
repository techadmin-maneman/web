// The same-origin rule the client, ops and technician surfaces enforce on writes
// (docs/decisions/0026-hosts-and-surfaces.md).

import { createMiddleware } from "hono/factory";
import type { AppEnv } from "./context.ts";
import { refuse } from "./errors.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Refuses a write whose Origin is not the page's own. Those surfaces
 * carry session cookies, and every *.maneman.in host counts as the same site,
 * so SameSite=Lax alone would let one surface's page post to another's API.
 */
export const requireSameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();
  const origin = c.req.header("Origin");
  if (origin === new URL(c.req.url).origin) return next();
  c.var.log.warn("cross_origin_write_refused", { has_origin: origin !== undefined });
  return refuse(c, "forbidden_origin");
});
