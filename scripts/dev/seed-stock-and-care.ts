// What npm run db:seed:local adds for the console's purchasing and Care screens, which no browser test's seed fills:
// a supplier of the seeded consumables, an order drafted to it, and two chats, one past the time Care had to answer
// it by, so the Tasks board shows it. Every name and number is made up; the ids are fixed, so a second run adds
// nothing twice.

import { sqlRow } from "../lib/sql-literal.ts";

const SUPPLIER = "0000d001-0000-4000-8000-000000000011";
const ORDER = "0000d001-0000-4000-8000-000000000012";
const CHATS = [
  {
    id: "0000d001-0000-4000-8000-000000000013",
    mobile: "+919810099011",
    text: "Can I move my visit to Saturday?",
    hoursAgo: 30,
  },
  {
    id: "0000d001-0000-4000-8000-000000000014",
    mobile: "+919810099012",
    text: "Do you come to Sector 57?",
    hoursAgo: 0,
  },
] as const;

const hoursBefore = (now: Date, hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();

/** The statements, after the consumables they order are seeded. */
export function stockAndCare(now: Date): string[] {
  const at = now.toISOString();
  return [
    `INSERT OR IGNORE INTO suppliers (id, name, gstin, country, currency, contact_name, contact_phone, contact_email,
       payment_terms_days, warranty_days, created_at, updated_at)
       VALUES ${sqlRow(SUPPLIER, "Lumina Hair Co", null, "IN", "INR", "Arjun Mehta", "+919810099021", null, 30, 90, at, at)};`,
    `INSERT OR IGNORE INTO supplier_items (supplier_id, consumable_code, their_code, unit_price, pack_size,
       minimum_order, lead_time_days, updated_at) VALUES
       ${sqlRow(SUPPLIER, "tape_strips", "LT-200", 1100, 50, 100, 7, at)},
       ${sqlRow(SUPPLIER, "bonding_glue", "LG-500", 85, 500, 1000, 7, at)};`,
    `INSERT OR IGNORE INTO purchase_orders (id, number, supplier_id, currency, state, expected_on, note, drafted_by,
       drafted_at, updated_at)
       VALUES ${sqlRow(ORDER, 9001, SUPPLIER, "INR", "drafted", null, "Seeded for the laptop", "seed", at, at)};`,
    `INSERT OR IGNORE INTO po_lines (id, po_id, consumable_code, quantity, unit_price, received_quantity) VALUES
       ${sqlRow(`${ORDER}-tape`, ORDER, "tape_strips", 200, 1100, 0)},
       ${sqlRow(`${ORDER}-glue`, ORDER, "bonding_glue", 1000, 85, 0)};`,
    ...CHATS.flatMap((chat) => {
      const said = hoursBefore(now, chat.hoursAgo);
      return [
        `INSERT OR IGNORE INTO conversations (id, person_id, mobile_e164, state, opened_at, last_message_at,
           last_inbound_at, created_at, updated_at)
           VALUES ${sqlRow(chat.id, null, chat.mobile, "open", said, said, said, said, said)};`,
        `INSERT OR IGNORE INTO chat_messages (id, conversation_id, direction, author, text, provider_message_id, sent_at,
           created_at)
           VALUES ${sqlRow(`${chat.id}-1`, chat.id, "in", "client", chat.text, null, said, said)};`,
      ];
    }),
  ];
}
