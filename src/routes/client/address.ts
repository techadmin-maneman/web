// The client's address (./profile.ts): the buildings matching what is typed so far, and the address saved.

// A POST, not a GET: each answer spends from Google's budget, and a GET goes with the cookie from any

import { z } from "@hono/zod-openapi";
import { addressChangeRefusal } from "../../domain/clients/address-change.ts";
import { saveClientAddress, suggestBuildings } from "../../http/address-save.ts";
import { clientOf } from "../../http/client-session.ts";
import type { App } from "../../http/context.ts";
import { errorBody, errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { clientRoute, signedIn } from "../../http/session-routes.ts";
import { AddressSaveSchema, AddressSchema, SuggestionsSchema, addressOf } from "../schemas/address.ts";

// page that links to it. A POST is held to the app's own Origin, as every write is.
const addressSuggestionsRoute = clientRoute({
  method: "post",
  path: "/api/address/suggestions",
  summary: "Buildings matching what the client has typed, for the address form",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            q: z.string().trim().min(1).max(200).openapi({ description: "What the client has typed so far." }),
            session: z
              .string()
              .trim()
              .min(1)
              .max(100)
              .openapi({ description: "One token for the whole search, sent again when the address is saved." }),
          })
          .strict()
          .openapi("AddressSuggestionsAsk"),
      ),
    },
  },
  responses: {
    200: { description: "The suggestions, which may be empty", ...json(SuggestionsSchema) },
    400: errorResponse("invalid_request"),
    503: errorResponse("busy: today's address-lookup ceiling is reached; unavailable: Google could not be reached"),
    ...signedIn,
  },
});

const addressRoute = clientRoute({
  method: "patch",
  path: "/api/profile/address",
  summary: "Replace the address visits go to, with its access notes",
  request: { body: { required: true, ...json(AddressSaveSchema) } },
  responses: {
    200: { description: "Saved", ...json(AddressSchema) },
    400: errorResponse("invalid_request"),
    409: errorResponse("visit_booked: a visit still to come is in another city, which the address may not leave"),
    422: errorResponse("not_served: the pincode is not one we come to"),
    ...signedIn,
  },
});

export function registerClientAddress(app: App): void {
  app.openapi(addressSuggestionsRoute, async (c) => {
    const { q, session } = c.req.valid("json");
    const answer = await suggestBuildings(c, {
      limitScope: "address_suggest",
      asker: clientOf(c).subjectId,
      q,
      session,
    });
    if (!answer.ok) return c.json(errorBody(answer.code, c.var.requestId), 503);
    return c.json({ suggestions: answer.suggestions, attribution: "Google Maps" as const }, 200);
  });

  app.openapi(addressRoute, async (c) => {
    const personId = clientOf(c).subjectId;
    const body = c.req.valid("json");
    const address = addressOf(body);
    const refusal = await addressChangeRefusal(c.env.DB, personId, address.pincode);
    if (refusal === "not_served") return refuse(c, "not_served");
    if (refusal === "visit_booked") return refuse(c, "visit_booked");
    await saveClientAddress(c, {
      personId,
      address,
      sessionToken: body.session_token,
      givenToOps: null,
    });
    return c.json(
      {
        line1: address.line1,
        line2: address.line2,
        locality: address.locality,
        city: address.city,
        pincode: address.pincode,
        access_notes: address.accessNotes,
        building: address.building,
        flat: address.flat,
        floor: address.floor,
        tower: address.tower,
        landmark: address.landmark,
        place_id: address.placeId,
      },
      200,
    );
  });
}
