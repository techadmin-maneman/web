// The ops surface refuses a request that does not carry a valid Cloudflare Access token
// (docs/decisions/0031-access-and-audit.md). Access already stops anyone without a login at the edge; the Worker
// checks the token again, so a request that reached it some other way is refused, and so every call can be
// audited under the person or service token behind it. The check is src/providers/cloudflare-access.ts.

import { createMiddleware } from "hono/factory";
import type { AppEnv } from "./context.ts";
import { errorBody } from "./errors.ts";

/** Refuses a request without a valid Access token; otherwise sets c.var.accessIdentity. */
export const requireAccess = createMiddleware<AppEnv>(async (c, next) => {
  const result = await c.var.deps.access.verify(c.req.raw);
  if (result.ok) {
    c.set("accessIdentity", result.identity);
    return next();
  }
  if (result.reason === "keys_unavailable") {
    c.var.log.error("access_keys_unavailable", { error: result.error });
    return c.json(errorBody("unavailable", c.var.requestId), 503);
  }
  c.var.log.warn("access_refused", { reason: result.reason });
  return c.json(errorBody("access_required", c.var.requestId), 403);
});
