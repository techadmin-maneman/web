// The open alerts as the console shows them (src/routes/ops/alerts.ts). The chat is told of a kit and a visit by their
// IDs; the console names a kit by its technician, and says whose visit an alert is about and on what day.

import { fullDate } from "@maneman/web-kit/dates";
import { indiaDate } from "../../lib/india-time.ts";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const KIT = new RegExp(`technician (${UUID})'s kit`, "g");
const VISIT = new RegExp(`\\bvisit (${UUID})`, "gi");

const idsIn = (alerts: readonly { readonly message: string }[], pattern: RegExp): string[] => [
  ...new Set(alerts.flatMap((alert) => [...alert.message.matchAll(pattern)].map((match) => match[1] ?? ""))),
];

/** Each alert's message with its kits named, and the client and day of the first visit it names, if it names one. */
export async function namedForTheConsole<A extends { readonly message: string }>(
  db: D1Database,
  alerts: readonly A[],
): Promise<(A & { readonly about: string | null })[]> {
  const kits = idsIn(alerts, KIT);
  const visits = idsIn(alerts, VISIT);
  const [technicians, clients] = await Promise.all([
    db
      .prepare("SELECT id, name FROM technicians WHERE id IN (SELECT value FROM json_each(?1))")
      .bind(JSON.stringify(kits))
      .all<{ id: string; name: string }>(),
    db
      .prepare(
        `SELECT a.id, p.name, a.window_start FROM appointments a
           LEFT JOIN people p ON p.id = a.person_id AND p.erased_at IS NULL
         WHERE a.id IN (SELECT value FROM json_each(?1))`,
      )
      .bind(JSON.stringify(visits))
      .all<{ id: string; name: string | null; window_start: string }>(),
  ]);
  const names = new Map(technicians.results.map((row) => [row.id, row.name]));
  const visitOf = new Map(clients.results.map((row) => [row.id, row]));
  return alerts.map((alert) => {
    const message = alert.message.replace(KIT, (kit, id: string) => {
      const name = names.get(id);
      return name === undefined ? kit : `${name}'s kit`;
    });
    const first = [...alert.message.matchAll(VISIT)][0]?.[1];
    const visit = first === undefined ? undefined : visitOf.get(first);
    const about =
      visit === undefined
        ? null
        : `${visit.name ?? "An erased client"}'s visit on ${fullDate(indiaDate(new Date(visit.window_start)))}`;
    return { ...alert, message, about };
  });
}
