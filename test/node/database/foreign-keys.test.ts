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
/** A city's row goes only in a rename, after every row naming it has moved to the new one. */
const RENAMED = "src/domain/cities/cities.ts moves it to the city's new name before the old row goes";

const HANDLED: Readonly<Record<string, string>> = {
  // A technician deleted with nothing worked (src/domain/dispatch/technician-roster.ts): their asks for leave first.
  "leave_requests.technician_id -> technicians": "deleted first, in the same batch",
  "leave_requests.leave_id -> technician_leave": "deleted first, in the same batch",
  // An erasure deletes a client's notes in one statement (src/domain/privacy/erasure-statements.ts).
  "staff_notes.replaces -> staff_notes": "deleted together, in the one statement",
  // The retention job's deletes of old rows (src/domain/privacy/retention.ts): a message held as a no-show's or a
  // move's evidence stays; a stranger's chat goes with its messages, and not while a city matter names it.
  "no_show_cases.message_id -> outbound_messages": "kept: not deleted while one names it",
  "dispatch_moves.message_id -> outbound_messages": "kept: not deleted while one names it",
  "chat_messages.conversation_id -> conversations": "deleted first, in the same batch",
  "city_matters.conversation_id -> conversations": "kept: not deleted while one names it",
  // A city renamed (docs/decisions/0198-cities-as-data.md).
  "leads.city -> cities": RENAMED,
  "technicians.city -> cities": RENAMED,
  "city_blackouts.city -> cities": RENAMED,
  "visit_pay_rates.city -> cities": RENAMED,
  "spend_entries.city -> cities": RENAMED,
  "targets.city -> cities": RENAMED,
  "stock_places.city -> cities": RENAMED,
  "city_prices.city -> cities": RENAMED,
  "city_settings.city -> cities": RENAMED,
  // A pay grade goes only once nothing uses it (docs/decisions/0122-technician-pay-per-visit.md).
  "technicians.pay_grade_id -> pay_grades":
    "src/domain/field/technician-pay.ts deletes a grade only while no technician holds it",
  "visit_pay_rates.grade_id -> pay_grades":
    "src/domain/field/technician-pay.ts deletes a grade only while no rate names it",
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
  "technician_hours.technician_id -> technicians": "src/domain/dispatch/technician-roster.ts deletes their week first",
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
  "move_proposals.technician_id -> technicians":
    "src/domain/dispatch/technician-roster.ts refuses to delete a technician it names",
  "slot_claims.technician_id -> technicians":
    "src/domain/dispatch/technician-roster.ts refuses to delete a technician it names",
  "stock_movements.technician_id -> technicians":
    "src/domain/dispatch/technician-roster.ts refuses to delete a technician it names",
  "stock_transfers.from_place -> stock_places":
    "src/domain/dispatch/technician-roster.ts deletes only a kit nothing has moved, which no transfer names",
  "stock_transfers.to_place -> stock_places":
    "src/domain/dispatch/technician-roster.ts deletes only a kit nothing has moved, which no transfer names",
  "stock_places.parent_id -> stock_places":
    "src/domain/dispatch/technician-roster.ts deletes only a kit, which no place hangs from",
  "stock_movements.place_id -> stock_places":
    "src/domain/dispatch/technician-roster.ts deletes only a kit, which no row names by place_id",
  "plan_lines.from_place -> stock_places":
    "src/domain/dispatch/technician-roster.ts deletes only a kit, and a plan line moves stock only between stockrooms and the warehouse",
  "plan_lines.to_place -> stock_places":
    "src/domain/dispatch/technician-roster.ts deletes only a kit, and a plan line moves stock only between stockrooms and the warehouse",
  "hair_profiles.technician_id -> technicians":
    "src/domain/dispatch/technician-roster.ts: the key itself refuses the batch, and nothing is deleted",
  // A consumable added by mistake goes with what services were set to use of it, and never once its stock has moved.
  "consumable_usage.consumable_code -> consumables":
    "src/domain/inventory/consumables.ts deletes each service's use of it first",
  "hair_systems.code -> consumables": "src/domain/inventory/consumables.ts deletes a hair system's spec first",
  "stock_movements.consumable_code -> consumables":
    "src/domain/inventory/consumables.ts refuses to delete one it names",
  "stock_balances.consumable_code -> consumables": "src/domain/inventory/consumables.ts refuses to delete one it names",
  "stock_transfers.consumable_code -> consumables":
    "src/domain/inventory/consumables.ts refuses to delete one a movement names, and a transfer comes only with one",
  "po_lines.consumable_code -> consumables":
    "src/domain/inventory/consumables.ts refuses to delete one an order names: the foreign key refuses its batch, answered in_use",
  "count_lines.consumable_code -> consumables":
    "src/domain/inventory/consumables.ts refuses to delete one a count line names: the foreign key refuses its batch, answered in_use",
  "plan_lines.consumable_code -> consumables":
    "src/domain/inventory/consumables.ts refuses to delete one a plan line names: the foreign key refuses its batch, answered in_use",
  "forecast_lines.run_id -> forecast_runs":
    "src/domain/purchasing/forecast.ts deletes an old run's lines before the run",
  "custom_orders.consumable_code -> consumables":
    "src/domain/inventory/consumables.ts refuses to delete one an order names, and a custom order's code is named by its order's line",
  "supplier_claims.consumable_code -> consumables":
    "src/domain/inventory/consumables.ts refuses to delete one an order names, and a claim comes only from an order's line",
  "supplier_items.consumable_code -> consumables":
    "src/domain/inventory/consumables.ts refuses to delete one a supplier lists: the foreign key refuses its batch, answered in_use",
  "stock_units.consumable_code -> consumables":
    "src/domain/inventory/consumables.ts refuses to delete one a movement names, and a unit comes only with stock that moved",
  "stock_lots.consumable_code -> consumables":
    "src/domain/inventory/consumables.ts refuses to delete one a movement names, and a lot comes only with a delivery",
  "consumables_used.consumable_code -> consumables":
    "src/domain/inventory/consumables.ts refuses to delete one it names",
  // A discount code made by mistake, and never once a booking has taken it.
  "discount_code_uses.code_id -> discount_codes":
    "src/domain/money/discount-codes.ts refuses to delete a code a use names",
  "referral_channels.discount_code_id -> discount_codes":
    "src/domain/money/discount-codes.ts refuses to delete a code a partner names",
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
