// The buildings matching what a visitor to /book has typed, for the address the visit is at
// (docs/decisions/0054-address-capture.md): the client app's search, held to the visitor's own day of suggestions,
// by their address's salted hash, and to the day's ceiling for every form.
//
// A POST, not a GET: each answer spends from Google's budget. It is held to the site's own Origin, as every write is.

import { createRoute, z } from "@hono/zod-openapi";
import { suggestBuildings } from "../../http/address-save.ts";
import type { App } from "../../http/context.ts";
import { errorBody, errorResponse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { visitorOf } from "../../http/visitor.ts";
import { SuggestionsSchema } from "../schemas/address.ts";

const buildingSuggestionsRoute = createRoute({
  method: "post",
  path: "/api/buildings/suggestions",
  summary: "Buildings matching what a visitor has typed, for the address on /book",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            q: z.string().trim().min(1).max(200).openapi({ description: "What the visitor has typed so far." }),
            session: z
              .string()
              .trim()
              .min(1)
              .max(100)
              .openapi({ description: "One token for the whole search, sent again with the booking." }),
            pincode: z
              .string()
              .regex(/^\d{6}$/)
              .optional()
              .openapi({
                description: "The pincode the address is at, where it is known: the search keeps near its city.",
              }),
          })
          .strict()
          .openapi("BuildingSuggestionsAsk"),
      ),
    },
  },
  responses: {
    200: { description: "The suggestions, which may be empty", ...json(SuggestionsSchema) },
    400: errorResponse("invalid_request"),
    503: errorResponse(
      "busy: the visitor's or the day's address-lookup ceiling is reached; unavailable: Google could not be reached",
    ),
  },
});

export function registerBuildingSuggestions(app: App): void {
  app.openapi(buildingSuggestionsRoute, async (c) => {
    const { q, session, pincode } = c.req.valid("json");
    const visitor = await visitorOf(c);
    const answer = await suggestBuildings(c, {
      limitScope: "site_address_suggest",
      asker: visitor.ipHash,
      q,
      session,
      pincode,
    });
    if (!answer.ok) return c.json(errorBody(answer.code, c.var.requestId), 503);
    return c.json({ suggestions: answer.suggestions, attribution: "Google Maps" as const }, 200);
  });
}
