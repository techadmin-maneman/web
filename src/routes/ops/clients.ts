// One client's record on the ops surface behind Access (docs/decisions/0031-access-and-audit.md). Finding a client is here; each section of their page has its file beside
// it: the record (./client-record.ts), the photographs (./client-photos.ts) and the consents (./client-consents.ts).
//
// A client is always found by their ID. What ops search with goes in a request
// body, never in a path, so that a number stays out of URLs, referrers and logs.
// Each route keeps to the caller's cities: a client elsewhere is not found.
//
// The records are the ones the client reads of themselves, through the same
// domain functions, so the two surfaces cannot drift apart. Of an erased person,
// the record answers only what is kept: when they were erased, their visits
// and their money. Every other route here does not find them: their photographs, address and details are gone (ADR 0049).

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import { typedDigits } from "@maneman/web-kit/mobile";
import {
  CLIENT_VIEWS,
  CLIENTS_PER_PAGE,
  listClients,
  NEXT_VISIT_COLUMNS,
  type ListedClient,
} from "../../domain/clients/client-list.ts";
import { CLIENT_STAGES, stageSql, type ClientStage } from "../../domain/clients/client-stage.ts";
import { reachBinding, withinReach } from "../../domain/clients/places.ts";
import type { App } from "../../http/context.ts";
import { stageDays } from "../../http/ops-inputs.ts";
import { clientsWaitedOn } from "../../http/task-board.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { countOf, CursorQuery, cursorOf, NextCursor } from "../../http/paging.ts";
import { routeReach, withinRouteReach, type PersonRow } from "../../http/staff-access.ts";
import { INDIAN_MOBILE_PATTERN, toE164 } from "../../lib/mobile.ts";
import { unknownClient } from "../schemas/clients.ts";
import { clientCities } from "../../domain/cities/cities.ts";

const UnderWay = z.boolean().openapi({ description: "Whether a visit of theirs has begun and is not yet closed." });
const Stage = z.enum(CLIENT_STAGES).openapi({
  description:
    "How far along they are: a lead, consulted, fitted, or active while within their service cadence and its grace.",
});
const searchRoute = opsRoute({
  method: "post",
  path: "/api/clients/search",
  summary: "Find a client by mobile number. A POST, so the number stays out of the URL",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({ mobile: z.string().regex(INDIAN_MOBILE_PATTERN) })
          .strict()
          .openapi("ClientSearch"),
      ),
    },
  },
  responses: {
    200: {
      description: "The client, to open their page with",
      ...json(z.object({ id: z.uuid(), name: z.string(), mobile: z.string() }).strict()),
    },
    400: errorResponse("invalid_request: not an Indian mobile number"),
    404: unknownClient,
  },
});

/** The most clients one search lists; past that, more letters or digits narrow it. */
export const CLIENTS_FOUND = 20;
/** A name is searched from two letters, a number from four digits, so no search lists everybody. */
const NAME_MIN = 2;
const DIGITS_MIN = 4;

const findRoute = opsRoute({
  method: "post",
  path: "/api/clients/find",
  summary:
    "Find clients by part of a name, or four or more digits of a number. A POST, so the words stay out of the URL",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            text: z
              .string()
              .trim()
              .max(60)
              .refine((text) => searchOf(text) !== null, `${String(NAME_MIN)} letters or ${String(DIGITS_MIN)} digits`)
              .openapi({ description: "Any part of a name, or of a number typed any of the usual ways." }),
          })
          .strict()
          .openapi("ClientFind"),
      ),
    },
  },
  responses: {
    200: {
      description: "The clients it matches in the caller's cities, by name",
      ...json(
        z
          .object({
            clients: z.array(
              z
                .object({
                  id: z.uuid(),
                  name: z.string(),
                  mobile: z.string(),
                  stage: Stage,
                  next_visit: z.union([z.iso.datetime(), z.null()]).openapi({
                    description: "When the client's next visit not yet closed starts; null for none.",
                  }),
                  under_way: UnderWay,
                })
                .strict(),
            ),
            more: z.boolean().openapi({ description: `More than ${String(CLIENTS_FOUND)} match: narrow the search.` }),
          })
          .strict()
          .openapi("ClientsFound"),
      ),
    },
    400: errorResponse("invalid_request: fewer than two letters or four digits"),
  },
});

const listRoute = opsRoute({
  method: "get",
  path: "/api/clients",
  summary: "Every client in the caller's cities, the soonest next visit first, then those with none, newest first",
  request: {
    query: z.object({
      view: z
        .enum(CLIENT_VIEWS)
        .optional()
        .openapi({
          description:
            "The leads, those with a visit to come, those fitted, those with none to come, or those a task on the " +
            "caller's board waits on; everyone, left out.",
        }),
      city: z.string().trim().min(1).max(60).optional(),
      cursor: CursorQuery,
    }),
  },
  responses: {
    200: {
      description: "A page of the list",
      ...json(
        z
          .object({
            clients: z.array(
              z
                .object({
                  id: z.uuid(),
                  name: z.string(),
                  mobile: z.string(),
                  stage: Stage,
                  city: z.union([z.string(), z.null()]).openapi({
                    description: "Their address's city, else where they last booked or asked to be told.",
                  }),
                  next_visit: z.union([z.iso.datetime(), z.null()]),
                  under_way: UnderWay,
                  package: z.union([z.string(), z.null()]).openapi({
                    description:
                      "The package they are on, by name; null before they book a first fit or ops choose one.",
                  }),
                  paid: z
                    .number()
                    .int()
                    .openapi({ description: "What they have paid, less what was refunded, in paise." }),
                })
                .strict(),
            ),
            counts: z
              .union([
                z
                  .object({
                    all: z.number().int().nonnegative(),
                    lead: z.number().int().nonnegative(),
                    booked: z.number().int().nonnegative(),
                    fitted: z.number().int().nonnegative(),
                    nothing_booked: z.number().int().nonnegative(),
                    needs: z.union([z.number().int().nonnegative(), z.null()]).openapi({
                      description: "Those a task waits on; null where the board was read only in part.",
                    }),
                  })
                  .strict(),
                z.null(),
              ])
              .openapi({
                description: "How many in the city asked for each view holds; on the first page, else null.",
              }),
            next_cursor: NextCursor.openapi({
              description: `The next page of ${String(CLIENTS_PER_PAGE)}; null on the last.`,
            }),
            cities: z.array(z.string()).openapi({ description: "The cities served that the caller reaches, by name." }),
          })
          .strict()
          .openapi("ClientList"),
      ),
    },
    400: errorResponse("invalid_request: a cursor this list did not give"),
  },
});

/** What a search looks in: the number, when it is digits as a number is typed, else the name. */
type Search = { readonly by: "number" | "name"; readonly text: string };

function searchOf(typed: string): Search | null {
  const digits = typed.replace(/[\s+-]/g, "");
  if (/^\d+$/.test(digits)) return digits.length >= DIGITS_MIN ? { by: "number", text: typedDigits(digits) } : null;
  return typed.length >= NAME_MIN ? { by: "name", text: typed } : null;
}

/** A LIKE pattern for text anywhere in the column, with LIKE's own wildcards taken as themselves. */
const containing = (text: string): string => `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

/** A client as the list answers them. */
const listedBody = (client: ListedClient) => ({
  id: client.id,
  name: client.name,
  mobile: client.mobile,
  stage: client.stage,
  city: client.city,
  next_visit: client.nextVisit,
  under_way: client.underWay,
  package: client.packageName,
  paid: client.paid,
});

export function registerOpsClients(app: App): void {
  app.openapi(listRoute, async (c) => {
    const { view, city, cursor } = c.req.valid("query");
    const page = countOf(cursor);
    if (page === null) return refuse(c, "invalid_request");
    const reach = reachBinding(await routeReach(c));
    // The board is read for the first page's count of those a task waits on, and for every page of that view.
    const [days, waited] = await Promise.all([
      stageDays(c),
      page === 0 || view === "needs" ? clientsWaitedOn(c, city) : null,
    ]);
    const [listed, served] = await Promise.all([
      listClients(c.env.DB, { view, needs: waited?.ids, city, page, reach, days }),
      clientCities(c.env.DB, reach),
    ]);
    return c.json(
      {
        clients: listed.clients.map(listedBody),
        // Those a task waits on are not counted where the board was read only in part.
        counts:
          listed.counts === null
            ? null
            : { ...listed.counts, needs: waited?.truncated === false ? listed.counts.needs : null },
        next_cursor: listed.more ? cursorOf(String(page + 1)) : null,
        cities: served,
      },
      200,
    );
  });

  app.openapi(searchRoute, async (c) => {
    const mobile = toE164(c.req.valid("json").mobile);
    if (mobile === null) return refuse(c, "invalid_request", ["mobile"]);
    const person = await c.env.DB.prepare(
      "SELECT id, name, mobile_e164, created_at FROM people WHERE mobile_e164 = ?1 AND erased_at IS NULL",
    )
      .bind(mobile)
      .first<PersonRow>();
    if (person === null || !(await withinRouteReach(c, "client", person.id))) return refuse(c, "not_found");
    return c.json({ id: person.id, name: person.name, mobile: person.mobile_e164 }, 200);
  });

  app.openapi(findRoute, async (c) => {
    const search = searchOf(c.req.valid("json").text);
    if (search === null) return refuse(c, "invalid_request", ["text"]);
    const column = search.by === "number" ? "mobile_e164" : "name";
    const [reached, days] = await Promise.all([routeReach(c), stageDays(c)]);
    const { results } = await c.env.DB.prepare(
      `SELECT client.id, client.name, client.mobile_e164, ${stageSql("client", "?4", "?5")} AS stage,
         ${NEXT_VISIT_COLUMNS("client")}
       FROM people client
       WHERE client.erased_at IS NULL AND client.${column} LIKE ?1 ESCAPE '\\'
         AND ${withinReach("client", "client", "?3")}
       ORDER BY client.name, client.id LIMIT ?2`,
    )
      .bind(containing(search.text), CLIENTS_FOUND + 1, reachBinding(reached), days.grace, days.today)
      .all<{
        id: string;
        name: string;
        mobile_e164: string;
        stage: ClientStage;
        next_visit: string | null;
        under_way: number;
      }>();
    // Each with where it stands and its next visit, so two clients of one name can be told apart.
    return c.json(
      {
        clients: results.slice(0, CLIENTS_FOUND).map((row) => ({
          id: row.id,
          name: row.name,
          mobile: row.mobile_e164,
          stage: row.stage,
          next_visit: row.next_visit,
          under_way: row.under_way === 1,
        })),
        more: results.length > CLIENTS_FOUND,
      },
      200,
    );
  });
}
