// Who is behind a call to the ops console, and the record of every call (docs/decisions/0031-access-and-audit.md).
// The log itself is src/domain/audit.ts.

import { createMiddleware } from "hono/factory";
import { routePath } from "hono/route";
import type { Context } from "hono";
import { recordAudit, type AuditActor } from "../domain/audit.ts";
import type { AccessIdentity } from "./access.ts";
import type { AppEnv } from "./context.ts";
import { errorBody } from "./errors.ts";

export function actorOf(identity: AccessIdentity): AuditActor {
  return identity.kind === "staff" ? { kind: "staff", id: identity.email } : { kind: "service", id: identity.clientId };
}

/** The member of staff behind the call; requireAccess has set it on every ops route. */
export function staffOf(c: Context<AppEnv>): AuditActor {
  const identity = c.var.accessIdentity;
  if (identity === undefined) throw new Error("ops routes run after requireAccess");
  return actorOf(identity);
}

/**
 * Records every call to an Access-protected surface under the identity that
 * made it, before the handler runs. Follows requireAccess.
 */
export const auditCall = createMiddleware<AppEnv>(async (c, next) => {
  const identity = c.var.accessIdentity;
  if (identity === undefined) throw new Error("auditCall runs after requireAccess");
  // Never write to a database not proven to be this environment's. Only /api/health
  // gets this far without that proof; it then answers 503 and reads nothing.
  const database = await c.var.checkIdentity(c.env.DB, c.var.config.environment);
  if (database.state !== "ok") return next();
  try {
    await recordAudit(
      c.env.DB,
      {
        surface: c.var.surface,
        actor: actorOf(identity),
        action: "ops.call",
        requestId: c.var.requestId,
        detail: { method: c.req.method, route: routePath(c, -1) },
      },
      c.var.deps.now(),
    );
  } catch (error) {
    c.var.log.error("audit_write_failed", { action: "ops.call", error });
    return c.json(errorBody("unavailable", c.var.requestId), 503);
  }
  return next();
});
