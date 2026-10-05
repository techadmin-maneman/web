// An address a client gives ops on the phone, recorded on their page
// (docs/decisions/0092-task-owners.md; open point 62). On the ops surface behind
// Access:
//
//   POST /api/clients/:id/address/suggestions   buildings matching what ops have typed so far
//   POST /api/clients/:id/address               save it as the client's address, marked as given to ops
//
// It is saved as the client's own save in the app saves one (src/http/address-save.ts): the same fields and checks,
// the building geocoded once within the day's ceiling, and the address sent on to Books and the CRM. It is
// marked with the member of staff who saved it, audited in the same batch, and replaces any address before it. A
// visit to come with no address then leaves the Tasks board, as it does when the client saves one.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../http/context.ts";
import { staffMemberOf, actorOf } from "../http/audit.ts";
import { saveClientAddress, suggestBuildings } from "../http/address-save.ts";
import { currentAddress } from "../domain/profile.ts";
import { errorBody, errorResponse, refuse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";
import { AddressSaveSchema, addressOf, SuggestionsSchema } from "./client-profile.ts";
import { ClientAddressSchema, clientAddressOf, clientInReach } from "./ops-clients.ts";

const clientId = z.object({ id: z.uuid() });
const unknownClient = errorResponse(
  "not_found: no such client, or the client has been erased or is outside the caller's cities",
);

const suggestionsRoute = createRoute({
  method: "post",
  path: "/api/clients/{id}/address/suggestions",
  summary: "Buildings matching what ops have typed of the address a client is giving them",
  request: {
    params: clientId,
    body: {
      required: true,
      ...json(
        z
          .object({
            q: z.string().trim().min(1).max(200).openapi({ description: "What ops have typed so far." }),
            session: z
              .string()
              .trim()
              .min(1)
              .max(100)
              .openapi({ description: "One token for the whole search, sent again when the address is saved." }),
          })
          .strict()
          .openapi("OpsAddressSuggestionsAsk"),
      ),
    },
  },
  responses: {
    200: { description: "The suggestions, which may be empty", ...json(SuggestionsSchema) },
    400: errorResponse("invalid_request"),
    403: errorResponse("access_required"),
    404: unknownClient,
    503: errorResponse("busy: today's address-lookup ceiling is reached; unavailable: Google could not be reached"),
  },
});

const saveRoute = createRoute({
  method: "post",
  path: "/api/clients/{id}/address",
  summary: "Save an address the client gave ops on the phone as theirs, marked as given to ops",
  request: { params: clientId, body: { required: true, ...json(AddressSaveSchema) } },
  responses: {
    200: { description: "Saved, and now the address visits go to", ...json(ClientAddressSchema) },
    400: errorResponse("invalid_request"),
    403: errorResponse("access_required: no Access token, or a service token, which names no member of staff"),
    404: unknownClient,
  },
});

export function registerOpsClientAddress(app: App): void {
  app.openapi(suggestionsRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { q, session } = c.req.valid("json");
    if ((await clientInReach(c, id)) === null) return refuse(c, "not_found");

    // Each member of staff has a day's suggestions of their own, as each client has.
    const answer = await suggestBuildings(c, { limitScope: "ops_address_suggest", asker: actorOf(c).id, q, session });
    if (!answer.ok) return c.json(errorBody(answer.code, c.var.requestId), 503);
    return c.json({ suggestions: answer.suggestions, attribution: "Google Maps" as const }, 200);
  });

  app.openapi(saveRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const { requestId } = c.var;
    const db = c.env.DB;
    const staff = staffMemberOf(c);
    if (staff === null) return refuse(c, "access_required");
    if ((await clientInReach(c, id)) === null) return refuse(c, "not_found");

    await saveClientAddress(c, {
      personId: id,
      address: addressOf(body),
      sessionToken: body.session_token,
      givenToOps: {
        staff: staff.id,
        audit: {
          surface: "ops",
          actor: staff,
          action: "address.given_to_ops",
          subject: { kind: "person", id },
          requestId,
        },
      },
    });
    const saved = await currentAddress(db, id);
    if (saved === null) throw new Error("the address just saved is not there");
    return c.json(clientAddressOf(saved), 200);
  });
}
