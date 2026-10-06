// Who is behind a call to the ops console, and the record of each call (docs/decisions/0031-access-and-audit.md).
// The log itself is src/domain/ops/audit.ts.

import { createMiddleware } from "hono/factory";
import { matchedRoutes } from "hono/route";
import type { Context } from "hono";
import { z } from "zod";
import { auditStatement, auditStatementUnlessRepeated, type AuditActor, type AuditEntry } from "../domain/ops/audit.ts";
import { MINUTE_MS } from "../lib/durations.ts";
import type { AccessIdentity } from "../providers/cloudflare-access.ts";
import type { AppEnv } from "./context.ts";
import { refuse } from "./errors.ts";

/** A GET of one path by one member of staff within this many minutes of the last is the same look. */
const REPEAT_LOOK_MINUTES = 10;

/** Say nothing of anyone: whether the Worker and its database are up, and the dispatch board's version number. */
const UNAUDITED_ROUTES = new Set(["/api/health", "/api/dispatch/version"]);

/** The routes that open one client's record or one visit, and what the `:id` in them names. */
const SUBJECT_ROUTES: readonly { readonly prefix: string; readonly kind: string }[] = [
  { prefix: "/api/clients/:id", kind: "person" },
  { prefix: "/api/visits/:id", kind: "appointment" },
];

const ID = z.uuid();

/** Who Access let in, as the audit log names them: a member of staff by e-mail, or a service token by its client ID. */
function auditActorOf(identity: AccessIdentity): AuditActor {
  return identity.kind === "staff" ? { kind: "staff", id: identity.email } : { kind: "service", id: identity.clientId };
}

/** Who is behind the call, a member of staff or a service token; requireAccess has set it on every ops route. */
export function actorOf(c: Context<AppEnv>): AuditActor {
  const identity = c.var.accessIdentity;
  if (identity === undefined) throw new Error("ops routes run after requireAccess");
  return auditActorOf(identity);
}

/**
 * The member of staff behind the call, or null for a service token: Access lets one in, and it names no person for
 * a write that is kept under whoever made it, a task's owner or an address given to ops (docs/decisions/0092-task-owners.md).
 */
export function staffMemberOf(c: Context<AppEnv>): AuditActor | null {
  const actor = actorOf(c);
  return actor.kind === "staff" ? actor : null;
}

/** The pattern of the route that answers the call, or null when none does and the call ends as not found. */
function answeringRoute(c: Context<AppEnv>): string | null {
  const last = matchedRoutes(c).at(-1);
  if (last === undefined || last.method === "ALL") return null;
  return last.path;
}

/** The path's parameters that are IDs, by name. Anything else typed into a path, a mobile number say, is left out. */
function idsInPath(route: string, path: string): Map<string, string> {
  const given = path.split("/");
  const ids = new Map<string, string>();
  route.split("/").forEach((part, index) => {
    const value = ID.safeParse(given[index]);
    if (part.startsWith(":") && value.success) ids.set(part.slice(1), value.data);
  });
  return ids;
}

/** Whose client record, or which visit, the call opens, if it opens one. */
function subjectOf(route: string, ids: Map<string, string>): AuditEntry["subject"] {
  const opened = SUBJECT_ROUTES.find(({ prefix }) => route === prefix || route.startsWith(`${prefix}/`));
  const id = ids.get("id");
  if (opened === undefined || id === undefined) return undefined;
  return { kind: opened.kind, id };
}

function opsCallEntry(c: Context<AppEnv>, identity: AccessIdentity, route: string): AuditEntry {
  const ids = idsInPath(route, c.req.path);
  const path = route.replace(/:(\w+)/g, (placeholder, name: string) => ids.get(name) ?? placeholder);
  return {
    surface: c.var.surface,
    actor: auditActorOf(identity),
    action: "ops.call",
    subject: subjectOf(route, ids),
    requestId: c.var.requestId,
    detail: { method: c.req.method, route, path },
  };
}

/**
 * Records each call to an Access-protected surface under the identity that made it, and whose record it opens,
 * before the handler runs. Follows requireAccess. A GET repeated within ten minutes is not recorded again.
 */
export const auditCall = createMiddleware<AppEnv>(async (c, next) => {
  const identity = c.var.accessIdentity;
  if (identity === undefined) throw new Error("auditCall runs after requireAccess");
  const route = answeringRoute(c);
  if (route === null || UNAUDITED_ROUTES.has(route)) return next();
  // Never write to a database not proven to be this environment's.
  const database = await c.var.checkIdentity(c.env.DB, c.var.config.environment);
  if (database.state !== "ok") return next();

  try {
    await recordCall(c.env.DB, opsCallEntry(c, identity, route), c.req.method, c.var.deps.now());
  } catch (error) {
    c.var.log.error("audit_write_failed", { action: "ops.call", error });
    return refuse(c, "unavailable");
  }
  return next();
});

/** A GET only looks, so one repeated within ten minutes is not written again; any other call is written each time. */
async function recordCall(db: D1Database, entry: AuditEntry, method: string, now: Date): Promise<void> {
  if (method !== "GET") {
    await auditStatement(db, entry, now).run();
    return;
  }
  const lastLookFrom = new Date(now.getTime() - REPEAT_LOOK_MINUTES * MINUTE_MS);
  await auditStatementUnlessRepeated(db, entry, now, lastLookFrom).run();
}
