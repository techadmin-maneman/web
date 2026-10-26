// The ops surface refuses a request that does not carry a valid Cloudflare Access token
// (docs/decisions/0031-access-and-audit.md). Access already stops anyone without a login at the edge; the Worker
// checks the token again, so a request that reached it some other way is refused, and so every call can be
// audited under the person or service token behind it. The check is src/providers/cloudflare-access.ts.

import { createMiddleware } from "hono/factory";
import type { AppEnv } from "./context.ts";
import { refuse } from "./errors.ts";
import { STUB_IDENTITY } from "../providers/cloudflare-access.ts";

/**
 * Locally, where the dev routes are on and Access is the stub, a run may sign a call in as another member of staff,
 * so the Staff list's refusals can be walked through (e2e/timelapse/). Nowhere else is it read.
 */
const DEV_STAFF_HEADER = "X-Dev-Staff";

/** Refuses a request without a valid Access token; otherwise sets c.var.accessIdentity. */
export const requireAccess = createMiddleware<AppEnv>(async (c, next) => {
  const result = await c.var.deps.access.verify(c.req.raw);
  if (result.ok) {
    const devStaff = c.req.header(DEV_STAFF_HEADER);
    const local = c.var.config.environment === "local" && c.var.config.settings.devRoutes;
    const asStaff = local && result.identity === STUB_IDENTITY && devStaff !== undefined;
    c.set("accessIdentity", asStaff ? { kind: "staff", email: devStaff.toLowerCase() } : result.identity);
    return next();
  }
  if (result.reason === "keys_unavailable") {
    c.var.log.error("access_keys_unavailable", { error: result.error });
    return refuse(c, "unavailable");
  }
  c.var.log.warn("access_refused", { reason: result.reason });
  return refuse(c, "access_required");
});
