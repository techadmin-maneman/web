// The console's list of clients (Clients): everyone in the caller's cities, a page at a time, the soonest next visit
// first, then those with none, the newest of them first; narrowed to where they stand and to a city; with each one's
// package and what they have paid, and, on the first page, how many stand where. Finding one by name or number is
// src/routes/ops/clients.ts.

import { fittedSql } from "./fitted.ts";
import { clientCityOf, withinReach } from "./places.ts";
import { clientStateOf, type ClientState } from "../visits/client-visits.ts";
import { statusIn, VISIT_LIVE } from "../../config/statuses.ts";

/** How many clients a page lists. */
export const CLIENTS_PER_PAGE = 50;

/** The visits of the client `alias` names that are not yet closed, as a subquery's FROM and WHERE. */
const UPCOMING_OF = (alias: string) => `FROM appointments a
  WHERE a.person_id = ${alias}.id AND a.deleted_at IS NULL AND a.window_start IS NOT NULL AND a.window_end IS NOT NULL
    AND ${statusIn("a.status", VISIT_LIVE)}`;

/** When the client's next visit not yet closed starts, and whether one has begun, as two columns. */
export const NEXT_VISIT_COLUMNS = (alias: string) => `(SELECT MIN(a.window_start) ${UPCOMING_OF(alias)}) AS next_visit,
  EXISTS (SELECT 1 ${UPCOMING_OF(alias)} AND a.status = 'in_progress') AS under_way`;

interface ListedClient {
  readonly id: string;
  readonly name: string;
  readonly mobile: string;
  readonly state: ClientState;
  /** The city of their address, else where they last booked or asked to be told; null where none is known. */
  readonly city: string | null;
  /** When their next visit not yet closed starts; null for none. */
  readonly nextVisit: string | null;
  /** Whether a visit of theirs has begun and is not yet closed. */
  readonly underWay: boolean;
  /** The package they are on, by name: the one they booked a first fit or replacement of, or ops put them on. */
  readonly packageName: string | null;
  /** What they have paid, less what was refunded, in paise: their page's Paid to date. */
  readonly paid: number;
}

/** How many of the caller's clients, in the city asked for, stand where. */
interface ClientCounts {
  readonly all: number;
  readonly lead: number;
  readonly fitted: number;
  readonly nothing_booked: number;
}

interface ClientListing {
  /** Where they stand; any, left out. */
  readonly state?: ClientState | undefined;
  readonly city?: string | undefined;
  /** From 0. */
  readonly page: number;
  /** The caller's cities as JSON, or null for everywhere (reachBinding). */
  readonly reach: string | null;
}

/** A page of the list, with each one's package and what they have paid, worked out for that page alone. */
const LISTED = `
  SELECT page.*,
    (SELECT f.name FROM people p JOIN services f ON f.kind = 'first_fit' AND f.tier = p.package
     WHERE p.id = page.id) AS package_name,
    (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.person_id = page.id AND p.status != 'failed')
      - (SELECT COALESCE(SUM(r.amount), 0) FROM refunds r JOIN payments p ON p.id = r.payment_id
         WHERE p.person_id = page.id) AS paid
  FROM (SELECT * FROM (
    SELECT client.id, client.name, client.mobile_e164, client.created_at, ${fittedSql("client.id")} AS fitted,
      ${NEXT_VISIT_COLUMNS("client")},
      ${clientCityOf("client")} AS city
    FROM people client
    WHERE client.erased_at IS NULL AND ${withinReach("client", "client", "?1")}
  ) listed
  WHERE (?2 IS NULL OR listed.city = ?2)
    AND (?3 IS NULL
      OR (?3 = 'fitted' AND listed.fitted = 1)
      OR (?3 = 'lead' AND listed.fitted = 0 AND listed.next_visit IS NOT NULL)
      OR (?3 = 'nothing_booked' AND listed.fitted = 0 AND listed.next_visit IS NULL))
  ORDER BY listed.next_visit IS NULL, listed.next_visit, listed.created_at DESC, listed.id
  LIMIT ?4 OFFSET ?5) page
  ORDER BY page.next_visit IS NULL, page.next_visit, page.created_at DESC, page.id`;

/** How many stand where, by the same reach and city as the list. */
const COUNTED = `
  SELECT COUNT(*) AS everyone,
    COALESCE(SUM(counted.fitted = 1), 0) AS fitted,
    COALESCE(SUM(counted.fitted = 0 AND counted.booked = 1), 0) AS lead,
    COALESCE(SUM(counted.fitted = 0 AND counted.booked = 0), 0) AS nothing_booked
  FROM (
    SELECT ${fittedSql("client.id")} AS fitted, EXISTS (SELECT 1 ${UPCOMING_OF("client")}) AS booked,
      ${clientCityOf("client")} AS city
    FROM people client
    WHERE client.erased_at IS NULL AND ${withinReach("client", "client", "?1")}
  ) counted
  WHERE ?2 IS NULL OR counted.city = ?2`;

interface Row {
  id: string;
  name: string;
  mobile_e164: string;
  fitted: number;
  next_visit: string | null;
  under_way: number;
  city: string | null;
  package_name: string | null;
  paid: number;
}

/** How many of the caller's clients in the city stand where. */
async function countClients(db: D1Database, listing: ClientListing): Promise<ClientCounts> {
  const row = await db
    .prepare(COUNTED)
    .bind(listing.reach, listing.city ?? null)
    .first<{ everyone: number; lead: number; fitted: number; nothing_booked: number }>();
  return {
    all: row?.everyone ?? 0,
    lead: row?.lead ?? 0,
    fitted: row?.fitted ?? 0,
    nothing_booked: row?.nothing_booked ?? 0,
  };
}

/** One page of the list, whether another follows it, and on the first page how many stand where; null on the rest. */
export async function listClients(
  db: D1Database,
  listing: ClientListing,
): Promise<{ readonly clients: ListedClient[]; readonly more: boolean; readonly counts: ClientCounts | null }> {
  const [{ results }, counts] = await Promise.all([
    db
      .prepare(LISTED)
      .bind(
        listing.reach,
        listing.city ?? null,
        listing.state ?? null,
        CLIENTS_PER_PAGE + 1,
        listing.page * CLIENTS_PER_PAGE,
      )
      .all<Row>(),
    listing.page === 0 ? countClients(db, listing) : null,
  ]);
  return {
    clients: results.slice(0, CLIENTS_PER_PAGE).map((row) => ({
      id: row.id,
      name: row.name,
      mobile: row.mobile_e164,
      state: clientStateOf(row.fitted === 1, row.next_visit !== null),
      city: row.city,
      nextVisit: row.next_visit,
      underWay: row.under_way === 1,
      packageName: row.package_name,
      paid: row.paid,
    })),
    more: results.length > CLIENTS_PER_PAGE,
    counts,
  };
}
