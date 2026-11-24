// The console's list of clients (Clients): everyone in the caller's cities, a page at a time, the soonest next visit
// first, then those with none, the newest of them first; narrowed to one of its views and to a city; with each one's
// stage (./client-stage.ts), package and what they have paid, and, on the first page, how many each view holds.
// Finding one by name or number is src/routes/ops/clients.ts.

import { stageSql, type ClientStage, type StageDays } from "./client-stage.ts";
import { clientCityOf, withinReach } from "./places.ts";
import { statusIn, VISIT_LIVE } from "../../config/statuses.ts";

/** How many clients a page lists. */
export const CLIENTS_PER_PAGE = 50;

/**
 * What the list may be narrowed to: the leads, those with a visit to come, those fitted (active too), those with none
 * to come, and those a task waits on, whose IDs the caller gives from the board (src/routes/ops/clients.ts).
 */
export const CLIENT_VIEWS = ["lead", "booked", "fitted", "nothing_booked", "needs"] as const;
type ClientView = (typeof CLIENT_VIEWS)[number];

/** The visits of the client `alias` names that are not yet closed, as a subquery's FROM and WHERE. */
const UPCOMING_OF = (alias: string) => `FROM appointments a
  WHERE a.person_id = ${alias}.id AND a.deleted_at IS NULL AND a.window_start IS NOT NULL AND a.window_end IS NOT NULL
    AND ${statusIn("a.status", VISIT_LIVE)}`;

/** When the client's next visit not yet closed starts, and whether one has begun, as two columns. */
export const NEXT_VISIT_COLUMNS = (alias: string) => `(SELECT MIN(a.window_start) ${UPCOMING_OF(alias)}) AS next_visit,
  EXISTS (SELECT 1 ${UPCOMING_OF(alias)} AND a.status = 'in_progress') AS under_way`;

export interface ListedClient {
  readonly id: string;
  readonly name: string;
  readonly mobile: string;
  readonly stage: ClientStage;
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

/** How many of the caller's clients, in the city asked for, each view holds. */
type ClientCounts = { readonly all: number } & Readonly<Record<ClientView, number>>;

interface ClientListing {
  /** Everyone, left out. */
  readonly view?: ClientView | undefined;
  /** The clients a task waits on, which the view "needs" lists and the first page counts; none, left out. */
  readonly needs?: readonly string[] | undefined;
  readonly city?: string | undefined;
  /** From 0. */
  readonly page: number;
  /** The caller's cities as JSON, or null for everywhere (reachBinding). */
  readonly reach: string | null;
  readonly days: StageDays;
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
    SELECT client.id, client.name, client.mobile_e164, client.created_at, ${stageSql("client", "?7", "?8")} AS stage,
      ${NEXT_VISIT_COLUMNS("client")},
      ${clientCityOf("client")} AS city
    FROM people client
    WHERE client.erased_at IS NULL AND ${withinReach("client", "client", "?1")}
      AND (?6 IS NULL OR client.id IN (SELECT value FROM json_each(?6)))
  ) listed
  WHERE (?2 IS NULL OR listed.city = ?2)
    AND (?3 IS NULL OR ?3 = 'needs'
      OR (?3 = 'lead' AND listed.stage = 'lead')
      OR (?3 = 'booked' AND listed.next_visit IS NOT NULL)
      OR (?3 = 'fitted' AND listed.stage IN ('fitted', 'active'))
      OR (?3 = 'nothing_booked' AND listed.next_visit IS NULL))
  ORDER BY listed.next_visit IS NULL, listed.next_visit, listed.created_at DESC, listed.id
  LIMIT ?4 OFFSET ?5) page
  ORDER BY page.next_visit IS NULL, page.next_visit, page.created_at DESC, page.id`;

/** How many each view holds, by the same reach and city as the list. */
const COUNTED = `
  SELECT COUNT(*) AS everyone,
    COALESCE(SUM(counted.stage = 'lead'), 0) AS lead,
    COALESCE(SUM(counted.booked), 0) AS booked,
    COALESCE(SUM(counted.stage IN ('fitted', 'active')), 0) AS fitted,
    COALESCE(SUM(counted.booked = 0), 0) AS nothing_booked,
    COALESCE(SUM(counted.waited), 0) AS needs
  FROM (
    SELECT ${stageSql("client", "?3", "?4")} AS stage, EXISTS (SELECT 1 ${UPCOMING_OF("client")}) AS booked,
      client.id IN (SELECT value FROM json_each(?5)) AS waited,
      ${clientCityOf("client")} AS city
    FROM people client
    WHERE client.erased_at IS NULL AND ${withinReach("client", "client", "?1")}
  ) counted
  WHERE ?2 IS NULL OR counted.city = ?2`;

interface Row {
  id: string;
  name: string;
  mobile_e164: string;
  stage: ClientStage;
  next_visit: string | null;
  under_way: number;
  city: string | null;
  package_name: string | null;
  paid: number;
}

/** How many of the caller's clients in the city each view holds. */
async function countClients(db: D1Database, listing: ClientListing): Promise<ClientCounts> {
  const row = await db
    .prepare(COUNTED)
    .bind(
      listing.reach,
      listing.city ?? null,
      listing.days.grace,
      listing.days.today,
      JSON.stringify(listing.needs ?? []),
    )
    .first<{ everyone: number } & Omit<ClientCounts, "all">>();
  return {
    all: row?.everyone ?? 0,
    lead: row?.lead ?? 0,
    booked: row?.booked ?? 0,
    fitted: row?.fitted ?? 0,
    nothing_booked: row?.nothing_booked ?? 0,
    needs: row?.needs ?? 0,
  };
}

/** One page of the list, whether another follows it, and on the first page how many each view holds; else null. */
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
        listing.view ?? null,
        CLIENTS_PER_PAGE + 1,
        listing.page * CLIENTS_PER_PAGE,
        listing.view === "needs" ? JSON.stringify(listing.needs ?? []) : null,
        listing.days.grace,
        listing.days.today,
      )
      .all<Row>(),
    listing.page === 0 ? countClients(db, listing) : null,
  ]);
  return {
    clients: results.slice(0, CLIENTS_PER_PAGE).map((row) => ({
      id: row.id,
      name: row.name,
      mobile: row.mobile_e164,
      stage: row.stage,
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
