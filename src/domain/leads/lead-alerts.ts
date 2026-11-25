// The unanswered-lead alert's pushes (docs/decisions/0323-the-unanswered-lead-alert.md): the phones Care people turned
// the alerts on for, three at most each, and, each minute, a push to every phone of each Care person on shift once a
// lead passes its alert time. A push carries nothing; the console's service worker says a lead is waiting. Each lead
// is pushed once, and one whose alert time passed more than an hour before is not pushed at all, so a release pages
// nobody for old leads.

import { DAY_MS, HOUR_MS } from "../../lib/durations.ts";
import type { CallBudget } from "../../lib/call-budget.ts";
import type { CareHours } from "../../policy/care-hours.ts";
import type { Push } from "../../providers/web-push.ts";
import { waitingLeads } from "./waiting-leads.ts";

/** How long a push waits for a phone that is off: past it, the banner has told Care already. */
const PUSH_TTL_SECONDS = 60 * 60;

/** How long the leads pushed are kept, well past the day a lead can wait between closing and the next alert. */
const PUSHES_KEPT_MS = 7 * DAY_MS;

/** The phones one person's alerts go to: their newest. */
const PHONES_EACH = 3;

/**
 * This phone takes the person's lead pushes, a phone someone else used before theirs now, and their oldest past three
 * let go; false where they are not on the Staff list.
 */
export async function keepStaffPhone(
  db: D1Database,
  { email, endpoint, now }: { readonly email: string; readonly endpoint: string; readonly now: Date },
): Promise<boolean> {
  const [kept] = await db.batch([
    db
      .prepare(
        `INSERT INTO staff_push_subscriptions (endpoint, email, subscribed_at)
         SELECT ?1, email, ?3 FROM staff WHERE email = ?2
         ON CONFLICT (endpoint) DO UPDATE SET email = excluded.email, subscribed_at = excluded.subscribed_at`,
      )
      .bind(endpoint, email, now.toISOString()),
    db
      .prepare(
        `DELETE FROM staff_push_subscriptions WHERE email = ?1 AND endpoint NOT IN (
           SELECT endpoint FROM staff_push_subscriptions WHERE email = ?1 ORDER BY subscribed_at DESC, rowid DESC LIMIT ?2)`,
      )
      .bind(email, PHONES_EACH),
  ]);
  return (kept?.meta.changes ?? 0) > 0;
}

/** The phones of each Care person on shift who still answers Care's chats: active, with national Customer Care · Act or more. */
const ON_SHIFT_PHONES = `SELECT p.endpoint AS endpoint FROM staff s CROSS JOIN staff_push_subscriptions p ON p.email = s.email
  WHERE s.active = 1 AND s.on_shift_since IS NOT NULL
    AND EXISTS (SELECT 1 FROM staff_grants g
      WHERE g.email = s.email AND g.department = 'customer_care' AND g.level IN ('act', 'manage')
        AND g.geography = 'national')`;

/**
 * A push to the phones of each Care person on shift for the leads newly past their alert time, once each; the number
 * of pushes sent. A phone the push service says is gone is forgotten. Where the calls run out, nothing is marked
 * pushed, and the next run tries again.
 */
export async function pushLeadAlerts(
  db: D1Database,
  {
    push,
    budget,
    now,
    hours,
  }: { readonly push: Push; readonly budget: CallBudget; readonly now: Date; readonly hours: CareHours },
): Promise<number> {
  // The phones first, from the few rows of the Care team: with nobody on shift taking pushes, no lead is read.
  const endpoints = (await db.prepare(ON_SHIFT_PHONES).all<{ endpoint: string }>()).results.map((row) => row.endpoint);
  if (endpoints.length === 0) return 0;
  const at = now.toISOString();
  const lately = new Date(now.getTime() - HOUR_MS).toISOString();
  const due = (await waitingLeads(db, { from: new Date(now.getTime() - DAY_MS), hours })).filter(
    (lead) => lead.alert_at <= at && lead.alert_at > lately,
  );
  if (due.length === 0) return 0;
  const pushed = await db
    .prepare("SELECT lead FROM lead_alert_pushes WHERE lead IN (SELECT value FROM json_each(?1))")
    .bind(JSON.stringify(due.map((lead) => lead.wait)))
    .all<{ lead: string }>();
  const told = new Set(pushed.results.map((row) => row.lead));
  const fresh = due.filter((lead) => !told.has(lead.wait));
  if (fresh.length === 0) return 0;
  const gone: string[] = [];
  let sent = 0;
  for (const endpoint of endpoints) {
    if (!budget.spend(1)) break;
    if ((await push(endpoint, PUSH_TTL_SECONDS)) === "gone") gone.push(endpoint);
    sent += 1;
  }
  const writes = [
    ...gone.map((endpoint) => db.prepare("DELETE FROM staff_push_subscriptions WHERE endpoint = ?1").bind(endpoint)),
    ...(sent === endpoints.length
      ? [
          db
            .prepare(
              `INSERT INTO lead_alert_pushes (lead, pushed_at) SELECT value, ?2 FROM json_each(?1) WHERE true
               ON CONFLICT (lead) DO NOTHING`,
            )
            .bind(JSON.stringify(fresh.map((lead) => lead.wait)), at),
        ]
      : []),
  ];
  if (writes.length > 0) await db.batch(writes);
  return sent;
}

/** The leads pushed a week ago and more, which no push can repeat: let go with the rest of the sweep. */
export const forgetOldLeadPushes = (db: D1Database, now: Date): D1PreparedStatement =>
  db
    .prepare("DELETE FROM lead_alert_pushes WHERE pushed_at < ?1")
    .bind(new Date(now.getTime() - PUSHES_KEPT_MS).toISOString());
