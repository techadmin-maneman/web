// The audit log (migrations/0005_audit.sql, docs/decisions/0031-access-and-audit.md).
// An entry is written before the action it records, and a failed write stops
// the action: nothing audited happens unaudited.

import { createMiddleware } from "hono/factory";
import { routePath } from "hono/route";
import type { AppEnv } from "../app.ts";
import type { Surface } from "../config/environments.ts";
import type { AccessIdentity } from "../http/access.ts";
import { errorBody } from "../http/errors.ts";

/** Every action the log records. Phase 2 milestones add theirs here. */
export const AUDIT_ACTIONS = [
  "ops.call",
  // The client's profile (docs/decisions/0042-client-profile.md).
  "consent.switch",
  "number_change.request",
  "number_change.decide",
  "deletion.request",
  "deletion.decide",
  // A held referral grant (docs/decisions/0048-referrals.md).
  "referral.decide",
  // A client's rights over their data (docs/decisions/0049-dpdp.md).
  "data.export",
  "grievance.raise",
  "grievance.resolve",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditActor = {
  readonly kind: "staff" | "service" | "client" | "technician" | "system";
  readonly id: string;
};

export interface AuditEntry {
  readonly surface: Surface;
  readonly actor: AuditActor;
  readonly action: AuditAction;
  readonly subject?: { readonly kind: string; readonly id: string };
  readonly requestId: string | null;
  /** IDs, counts and codes only. Never a name, a mobile number or an image reference. */
  readonly detail?: Readonly<Record<string, string | number | boolean>>;
}

/** The entry as a statement, to run in one batch with the action it records: both happen, or neither. */
export function auditStatement(db: D1Database, entry: AuditEntry, now: Date): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log (at, surface, actor_kind, actor, action, subject_kind, subject_id, request_id, detail)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      now.toISOString(),
      entry.surface,
      entry.actor.kind,
      entry.actor.id,
      entry.action,
      entry.subject?.kind ?? null,
      entry.subject?.id ?? null,
      entry.requestId,
      entry.detail === undefined ? null : JSON.stringify(entry.detail),
    );
}

export async function recordAudit(db: D1Database, entry: AuditEntry, now: Date): Promise<void> {
  await auditStatement(db, entry, now).run();
}

export function actorOf(identity: AccessIdentity): AuditActor {
  return identity.kind === "staff" ? { kind: "staff", id: identity.email } : { kind: "service", id: identity.clientId };
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
