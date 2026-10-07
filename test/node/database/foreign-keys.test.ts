// Every foreign key in the schema is NO ACTION: deleting a row that another
// row points at fails the statement, and the whole batch it runs in. It
// stopped the cron once a revoked phone's session was due for deletion, and
// every erasure of a client with a check-in or a number change. So for each
// table the code deletes from, every reference to it must be dealt with first,
// in the same batch, and this holds the code to a written answer for each. A
// new DELETE, or a new reference to a table the code deletes from, fails here
// until it has one (docs/migrations.md).

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

/** "child.column -> parent": how the rows pointing at a deleted row are dealt with first. */
const HANDLED: Readonly<Record<string, string>> = {
  "technician_devices.session_id -> sessions":
    "src/scheduled/sweeper.ts clears it in the batch that deletes the session",
  "photos.photo_set_id -> photo_sets": "src/domain/privacy/erasure.ts deletes a set's photographs first",
  "checkins.address_id -> addresses":
    "src/domain/privacy/erasure.ts blanks an address a check-in points at, and keeps it",
  "otp_challenges.number_change_id -> number_change_requests":
    "src/domain/privacy/erasure.ts deletes the change's codes first",
  // A technician added by mistake goes with what is theirs alone, and never once any work of theirs is recorded.
  "otp_challenges.technician_id -> technicians":
    "src/domain/dispatch/technician-roster.ts deletes their sign-in codes first",
  "technician_devices.technician_id -> technicians":
    "src/domain/dispatch/technician-roster.ts deletes their phones first",
  "technician_leave.technician_id -> technicians": "src/domain/dispatch/technician-roster.ts deletes their leave first",
  "job_events.device_id -> technician_devices":
    "src/domain/dispatch/technician-roster.ts deletes no phone of a technician a job event names",
  "appointments.technician_id -> technicians":
    "src/domain/dispatch/technician-roster.ts refuses to delete a technician it names",
  "slot_holds.technician_id -> technicians":
    "src/domain/dispatch/technician-roster.ts refuses to delete a technician it names",
  "checkins.technician_id -> technicians":
    "src/domain/dispatch/technician-roster.ts refuses to delete a technician it names",
  "job_events.technician_id -> technicians":
    "src/domain/dispatch/technician-roster.ts refuses to delete a technician it names",
  "dispatch_moves.was_technician_id -> technicians":
    "src/domain/dispatch/technician-roster.ts refuses to delete a technician it names",
  "dispatch_moves.now_technician_id -> technicians":
    "src/domain/dispatch/technician-roster.ts refuses to delete a technician it names",
  "slot_claims.technician_id -> technicians":
    "src/domain/dispatch/technician-roster.ts refuses to delete a technician it names",
  "stock_movements.technician_id -> technicians":
    "src/domain/dispatch/technician-roster.ts refuses to delete a technician it names",
  "hair_profiles.technician_id -> technicians":
    "src/domain/dispatch/technician-roster.ts: the key itself refuses the batch, and nothing is deleted",
  // A consumable added by mistake goes with what services were set to use of it, and never once its stock has moved.
  "consumable_usage.consumable_code -> consumables":
    "src/domain/field/consumables.ts deletes each service's use of it first",
  "stock_movements.consumable_code -> consumables": "src/domain/field/consumables.ts refuses to delete one it names",
  "stock_balances.consumable_code -> consumables": "src/domain/field/consumables.ts refuses to delete one it names",
  "consumables_used.consumable_code -> consumables": "src/domain/field/consumables.ts refuses to delete one it names",
  // A discount code made by mistake, and never once a booking has taken it.
  "discount_code_uses.code_id -> discount_codes":
    "src/domain/money/discount-codes.ts refuses to delete a code a use names",
  // A member of staff taken off the list.
  "staff_grants.email -> staff": "src/domain/ops/staff.ts deletes their grants first",
};

function sourceFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = `${folder}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

/** Every table a statement in src/ deletes rows from. */
function deletedFrom(): Set<string> {
  const tables = new Set<string>();
  for (const file of sourceFiles("src")) {
    for (const match of readFileSync(file, "utf8").matchAll(/\bDELETE\s+FROM\s+(\w+)/gi)) tables.add(match[1] ?? "");
  }
  return tables;
}

/** Every foreign key in the migrated schema, as "child.column -> parent". */
function references(): { key: string; parent: string }[] {
  const db = new DatabaseSync(":memory:");
  const migrations = readdirSync("migrations").filter((name) => name.endsWith(".sql"));
  for (const file of migrations.sort()) db.exec(readFileSync(`migrations/${file}`, "utf8"));
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
  return tables.flatMap(({ name }) => {
    const keys = db.prepare(`PRAGMA foreign_key_list("${name}")`).all() as { table: string; from: string }[];
    return keys.map((key) => ({ key: `${name}.${key.from} -> ${key.table}`, parent: key.table }));
  });
}

describe("deleting rows that other rows point at", () => {
  const deleted = deletedFrom();
  const pointing = references().filter((reference) => deleted.has(reference.parent));

  it("finds the deletes it guards", () => {
    expect([...deleted]).toEqual(expect.arrayContaining(["sessions", "addresses", "number_change_requests"]));
  });

  it("deals with every reference to a table the code deletes from", () => {
    expect(pointing.map((reference) => reference.key).filter((key) => !(key in HANDLED))).toEqual([]);
  });

  it("names no reference that has gone, or that points at a table nothing deletes from", () => {
    const live = new Set(pointing.map((reference) => reference.key));
    expect(Object.keys(HANDLED).filter((key) => !live.has(key))).toEqual([]);
  });
});
