// Where we go, and from when (serviceable_pincodes, migration 0021;
// docs/decisions/0060-ops-editable-inputs.md).
//
// `served` decides whether the app offers a booking at a pincode at all; a
// client at one we do not serve is offered the waitlist instead. `launched_at`
// is the day a technician started coming, and it is a promise: a referral
// invite held for that area lapses twelve months from it, and the waitlist
// alert goes out against it (ADR 0048). So it is dated and `served` is not.
//
// The rows themselves are loaded from data/pincodes/ncr-pincodes.csv by
// scripts/import-pincodes.ts, which is where a pincode's area and city come
// from. Ops change only the two columns that are theirs, and never add or
// remove a pincode: that file is the reference data.

import { indiaInstant } from "../lib/india-time.ts";
import { auditStatement, type AuditActor } from "./audit.ts";

export interface AreaPincode {
  readonly pincode: string;
  readonly area: string;
  readonly city: string;
  readonly served: boolean;
  /** India's date it started or starts, or null where nobody has said. */
  readonly launch_on: string | null;
}

/** One pincode's two columns, as ops send them. */
export interface AreaChange {
  readonly pincode: string;
  readonly served: boolean;
  readonly launch_on: string | null;
}

type Row = { pincode: string; area: string; city: string; served: number; launched_at: string | null };

const pincodeOf = (row: Row): AreaPincode => ({
  pincode: row.pincode,
  area: row.area,
  city: row.city,
  served: row.served === 1,
  launch_on: row.launched_at === null ? null : row.launched_at.slice(0, 10),
});

/** Every pincode we hold, by city and then by pincode, as the console lists them. */
export async function serviceArea(db: D1Database): Promise<AreaPincode[]> {
  const { results } = await db
    .prepare("SELECT pincode, area, city, served, launched_at FROM serviceable_pincodes ORDER BY city, pincode")
    .all<Row>();
  return results.map(pincodeOf);
}

/** Why a change cannot be made. */
export type AreaRefusal =
  { readonly kind: "unknown"; readonly pincodes: readonly string[] } | { readonly kind: "empty_area" };

export interface AreaResult {
  /** The pincodes whose two columns this actually altered. */
  readonly changed: readonly AreaChange[];
  readonly served: number;
}

/**
 * Sets `served` and `launch_on` on the pincodes named, and nothing else. Every
 * pincode altered gets its own audit entry naming what it was and what it is,
 * and the whole change goes in one batch with them: a change that is not
 * recorded does not happen (ADR 0031).
 *
 * Two refusals, both about ops not being able to turn the business off by
 * accident: a pincode we do not hold, and a change that would leave no served
 * pincode at all, which would put every client on the waitlist.
 */
export async function setServiceArea(
  db: D1Database,
  input: {
    readonly changes: readonly AreaChange[];
    readonly actor: AuditActor;
    readonly requestId: string;
    readonly now: Date;
  },
): Promise<AreaResult | AreaRefusal> {
  const { changes, actor, requestId, now } = input;
  const held = new Map((await serviceArea(db)).map((pincode) => [pincode.pincode, pincode]));

  const unknown = changes.filter((change) => !held.has(change.pincode)).map((change) => change.pincode);
  if (unknown.length > 0) return { kind: "unknown", pincodes: unknown };

  const changed = changes.filter((change) => {
    const was = held.get(change.pincode);
    return was !== undefined && (was.served !== change.served || was.launch_on !== change.launch_on);
  });

  const after = new Map(held);
  for (const change of changes) {
    const was = held.get(change.pincode);
    if (was !== undefined) after.set(change.pincode, { ...was, served: change.served, launch_on: change.launch_on });
  }
  const served = [...after.values()].filter((pincode) => pincode.served).length;
  if (served === 0) return { kind: "empty_area" };
  if (changed.length === 0) return { changed: [], served };

  await db.batch(
    changed.flatMap((change) => {
      const was = held.get(change.pincode);
      return [
        auditStatement(
          db,
          {
            surface: "ops",
            actor,
            action: "pincode.set",
            subject: { kind: "pincode", id: change.pincode },
            requestId,
            detail: {
              served_from: was?.served ?? false,
              served_to: change.served,
              launch_from: was?.launch_on ?? "",
              launch_to: change.launch_on ?? "",
            },
          },
          now,
        ),
        db.prepare("UPDATE serviceable_pincodes SET served = ?2, launched_at = ?3 WHERE pincode = ?1").bind(
          change.pincode,
          change.served ? 1 : 0,
          // Midnight in India on the day, as every other time in the database is an instant.
          change.launch_on === null ? null : indiaInstant(change.launch_on, "00:00").toISOString(),
        ),
      ];
    }),
  );
  return { changed, served };
}
