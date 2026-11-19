// A pincode deleted from the service area while we do not go there and nothing names it
// (docs/decisions/0283-changed-and-deleted-while-unused.md): one added by mistake. One a client, visit, hold,
// waitlist, request, attribution or launch names stays, served or not.

import { auditStatementIfDeleted, type AuditActor } from "../platform/audit.ts";

/** Every column that names a pincode we hold. */
const PINCODE_COLUMNS: readonly (readonly [table: string, column: string])[] = [
  ["addresses", "pincode"],
  ["appointments", "service_pincode"],
  ["channel_attributions", "pincode"],
  ["consultation_requests", "pincode"],
  ["pincode_launch_pincodes", "pincode"],
  ["referral_attributions", "pincode"],
  ["slot_holds", "pincode"],
  ["waitlist_entries", "pincode"],
];

/** That nothing names the pincode `pin`, a bound parameter or a column. */
const unused = (pin: string): string =>
  PINCODE_COLUMNS.map(([table, column]) => `NOT EXISTS (SELECT 1 FROM ${table} WHERE ${column} = ${pin})`).join(
    " AND ",
  );

/** The pincodes we hold but do not go to, which nothing names: those that may be deleted. */
export async function deletablePincodes(db: D1Database): Promise<ReadonlySet<string>> {
  const { results } = await db
    .prepare(`SELECT pincode FROM serviceable_pincodes p WHERE p.served = 0 AND ${unused("p.pincode")}`)
    .all<{ pincode: string }>();
  return new Set(results.map((row) => row.pincode));
}

/** A pincode deleted while we do not go there and nothing names it; its audit entry only if it went. */
export async function deletePincode(
  db: D1Database,
  input: { readonly pincode: string; readonly city: string; readonly actor: AuditActor; readonly requestId: string },
  now: Date,
): Promise<"deleted" | "in_use"> {
  const { pincode, city, actor, requestId } = input;
  await db.batch([
    db.prepare(`DELETE FROM serviceable_pincodes WHERE pincode = ?1 AND served = 0 AND ${unused("?1")}`).bind(pincode),
    auditStatementIfDeleted(
      db,
      {
        surface: "ops",
        actor,
        action: "pincode.delete",
        subject: { kind: "pincode", id: pincode },
        requestId,
        detail: { city },
      },
      now,
      { table: "serviceable_pincodes", column: "pincode", value: pincode },
    ),
  ]);
  const kept = await db.prepare("SELECT 1 FROM serviceable_pincodes WHERE pincode = ?1").bind(pincode).first();
  return kept === null ? "deleted" : "in_use";
}
