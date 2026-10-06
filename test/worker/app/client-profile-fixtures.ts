// What the client profile tests share (client-profile, client-address, client-consents and client-number-change): the
// numbers and origin they use, a pincode served, and the audit trail each reads.

import { env } from "cloudflare:workers";

export const ORIGIN = "https://maneman.test";

export const OLD = "+919810000001";

export const NEW = "+919810000003";

/** A pincode we hold, served unless `served` is false. */
export async function servedPincode(pincode: string, city: string, served = true) {
  await env.DB.prepare(
    "INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at) VALUES (?1, ?2, ?2, ?3, ?4)",
  )
    .bind(pincode, city, served ? 1 : 0, served ? "2026-09-01T18:30:00.000Z" : null)
    .run();
}

export async function auditActions(): Promise<string[]> {
  const rows = await env.DB.prepare("SELECT action FROM audit_log WHERE action != 'ops.call' ORDER BY id").all();
  return rows.results.map((row) => String(row.action));
}
