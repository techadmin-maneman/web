// The console's list of clients (Clients): everyone in the caller's cities, a page at a time, the soonest next visit
// first, then those with none, the newest of them first; narrowed to where they stand and to a city. Finding one by
// name or number is src/routes/ops/clients.ts.

import { fittedSql } from "./fitted.ts";
import { clientCityOf, withinReach } from "./places.ts";
import { clientStateOf, UPCOMING_STATUSES, type ClientState } from "../visits/client-visits.ts";

/** How many clients a page lists. */
export const CLIENTS_PER_PAGE = 50;

/** The visits of the client `alias` names that are not yet closed, as a subquery's FROM and WHERE. */
const UPCOMING_OF = (alias: string) => `FROM appointments a
  WHERE a.person_id = ${alias}.id AND a.deleted_at IS NULL AND a.window_start IS NOT NULL AND a.window_end IS NOT NULL
    AND a.status IN ${UPCOMING_STATUSES}`;

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

const LISTED = `
  SELECT * FROM (
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
  LIMIT ?4 OFFSET ?5`;

interface Row {
  id: string;
  name: string;
  mobile_e164: string;
  fitted: number;
  next_visit: string | null;
  under_way: number;
  city: string | null;
}

/** One page of the list, and whether another follows it. */
export async function listClients(
  db: D1Database,
  listing: ClientListing,
): Promise<{ readonly clients: ListedClient[]; readonly more: boolean }> {
  const { results } = await db
    .prepare(LISTED)
    .bind(
      listing.reach,
      listing.city ?? null,
      listing.state ?? null,
      CLIENTS_PER_PAGE + 1,
      listing.page * CLIENTS_PER_PAGE,
    )
    .all<Row>();
  return {
    clients: results.slice(0, CLIENTS_PER_PAGE).map((row) => ({
      id: row.id,
      name: row.name,
      mobile: row.mobile_e164,
      state: clientStateOf(row.fitted === 1, row.next_visit !== null),
      city: row.city,
      nextVisit: row.next_visit,
      underWay: row.under_way === 1,
    })),
    more: results.length > CLIENTS_PER_PAGE,
  };
}
