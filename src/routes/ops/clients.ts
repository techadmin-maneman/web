// One client's record on the ops surface behind Access (Ops Console, B1 to B3;
// docs/decisions/0031-access-and-audit.md). Finding a client is here; each section of their page has its file beside
// it: the record (./client-record.ts), the photographs (./client-photos.ts) and the consents (./client-consents.ts).
//   POST /api/clients/search               find a client by their whole mobile number
//   POST /api/clients/find                 find clients by part of a name or of a number
//   GET  /api/clients/:id                  who they are, their address, their visits, their payments, payment links
//                                          and invoices, their history, the invite they came with, and any
//                                          booking that refunded its payment by itself
//   GET  /api/clients/:id/photos           which photographs exist, by visit. No links: this is the locked view
//   POST /api/clients/:id/photos/view      open them: one audit entry, and who opened them before
//   GET  /api/clients/:id/photos/:photoId  one photograph, served within a logged opening
//   GET  /api/clients/:id/consents         every consent with its notice version, date and where it was given, and any
//                                          deletion request
//
// A client is always found by their ID. What ops search with goes in a request
// body, never in a path, so that a number stays out of URLs, referrers and logs.
// Each route keeps to the caller's cities: a client elsewhere is not found.
//
// The records are the ones the client reads of themselves, through the same
// domain functions, so the two surfaces cannot drift apart. Of an erased person,
// the record answers only what is kept: when they were erased, their visits
// and their money. Every other route here does not find them: their photographs, address and details are gone (ADR 0049).

import { createRoute, z } from "@hono/zod-openapi";
import { typedDigits } from "@maneman/web-kit/mobile";
import { fittedSql } from "../../domain/clients/fitted.ts";
import { reachBinding, withinReach } from "../../domain/clients/places.ts";
import { CLIENT_STATES, clientStateOf, UPCOMING_STATUSES } from "../../domain/visits/client-visits.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { routeReach, withinRouteReach, type PersonRow } from "../../http/staff-access.ts";
import { INDIAN_MOBILE_PATTERN, toE164 } from "../../lib/mobile.ts";
import { unknownClient } from "../schemas/clients.ts";

const searchRoute = createRoute({
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

const findRoute = createRoute({
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
                  state: z.enum(CLIENT_STATES),
                  next_visit: z.union([z.iso.datetime(), z.null()]).openapi({
                    description: "When the client's next visit not yet closed starts; null for none.",
                  }),
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

/** What a search looks in: the number, when it is digits as a number is typed, else the name. */
type Search = { readonly by: "number" | "name"; readonly text: string };

function searchOf(typed: string): Search | null {
  const digits = typed.replace(/[\s+-]/g, "");
  if (/^\d+$/.test(digits)) return digits.length >= DIGITS_MIN ? { by: "number", text: typedDigits(digits) } : null;
  return typed.length >= NAME_MIN ? { by: "name", text: typed } : null;
}

/** A LIKE pattern for text anywhere in the column, with LIKE's own wildcards taken as themselves. */
const containing = (text: string): string => `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

export function registerOpsClients(app: App): void {
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
    const reached = await routeReach(c);
    const { results } = await c.env.DB.prepare(
      `SELECT client.id, client.name, client.mobile_e164, ${fittedSql("client.id")} AS fitted,
         (SELECT MIN(a.window_start) FROM appointments a
          WHERE a.person_id = client.id AND a.deleted_at IS NULL AND a.window_start IS NOT NULL
            AND a.window_end IS NOT NULL AND a.status IN ${UPCOMING_STATUSES}) AS next_visit
       FROM people client
       WHERE client.erased_at IS NULL AND client.${column} LIKE ?1 ESCAPE '\\'
         AND ${withinReach("client", "client", "?3")}
       ORDER BY client.name, client.id LIMIT ?2`,
    )
      .bind(containing(search.text), CLIENTS_FOUND + 1, reachBinding(reached))
      .all<{ id: string; name: string; mobile_e164: string; fitted: number; next_visit: string | null }>();
    // Each with where it stands and its next visit, so two clients of one name can be told apart.
    return c.json(
      {
        clients: results.slice(0, CLIENTS_FOUND).map((row) => ({
          id: row.id,
          name: row.name,
          mobile: row.mobile_e164,
          state: clientStateOf(row.fitted === 1, row.next_visit !== null),
          next_visit: row.next_visit,
        })),
        more: results.length > CLIENTS_FOUND,
      },
      200,
    );
  });
}
