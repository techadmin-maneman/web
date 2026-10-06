// A client's consents in the console (./clients.ts), each with its notice version, date and where it was given, and
// any deletion request. Read only: ops never grant a consent.

import { createRoute, z } from "@hono/zod-openapi";
import { consentRecordsOf, type ConsentState } from "../../domain/clients/profile.ts";
import type { App } from "../../http/context.ts";
import { refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { clientInReach } from "../../http/staff-access.ts";
import { CONSENT_PURPOSES, CONSENT_SOURCES } from "../../policy/consents.ts";
import { clientId, unknownClient } from "../schemas/clients.ts";

const ClientConsentsSchema = z
  .object({
    consents: z.array(
      z
        .object({
          purpose: z.enum(CONSENT_PURPOSES),
          state: z.enum(["given", "withdrawn", "not_given"]).openapi({
            description: "not_given until the client first switches it on; withdrawn once they switch it back off.",
          }),
          notice_version: z
            .union([z.string(), z.null()])
            .openapi({ description: "The notice the client saw when they last switched it." }),
          at: z.union([z.iso.datetime(), z.null()]).openapi({ description: "When they last switched it." }),
          source: z.union([z.enum(CONSENT_SOURCES), z.null()]).openapi({
            description:
              "Where they last switched it. null when never switched, or when no place was kept: given before this release reached the environment on a notice shown in more than one place, written by the Worker it replaced between its migration and its deploy, or switched from a copy of the app loaded before it, which names no screen.",
          }),
        })
        .strict(),
    ),
    deletion: z
      .union([
        z
          .object({
            id: z.uuid(),
            state: z.enum(["requested", "rejected"]),
            requested_at: z.iso.datetime(),
            decided_at: z.union([z.iso.datetime(), z.null()]),
          })
          .strict(),
        z.null(),
      ])
      .openapi({ description: "Their latest deletion request. A processed one leaves no client to read." }),
  })
  .strict()
  .openapi("ClientConsents");

/** A purpose as the console shows it: given, never given, or given and then withdrawn. */
function consentStateOf(consent: ConsentState): "given" | "not_given" | "withdrawn" {
  if (consent.granted) return "given";
  return consent.since === null ? "not_given" : "withdrawn";
}

const consentsRoute = createRoute({
  method: "get",
  path: "/api/clients/{id}/consents",
  summary: "The client's consents and any deletion request. Ops read them and never grant one",
  request: { params: clientId },
  responses: { 200: { description: "Consents and data", ...json(ClientConsentsSchema) }, 404: unknownClient },
});

export function registerOpsClientConsents(app: App): void {
  app.openapi(consentsRoute, async (c) => {
    const { id } = c.req.valid("param");
    const db = c.env.DB;
    if ((await clientInReach(c, id)) === null) return refuse(c, "not_found");

    const [consents, deletion] = await Promise.all([
      consentRecordsOf(db, id),
      db
        .prepare(
          `SELECT id, state, created_at, decided_at FROM deletion_requests
           WHERE person_id = ?1 AND state != 'done' ORDER BY created_at DESC LIMIT 1`,
        )
        .bind(id)
        .first<{ id: string; state: "requested" | "rejected"; created_at: string; decided_at: string | null }>(),
    ]);
    return c.json(
      {
        consents: consents.map((consent) => ({
          purpose: consent.purpose,
          state: consentStateOf(consent),
          notice_version: consent.noticeVersion,
          at: consent.since,
          source: consent.source,
        })),
        deletion:
          deletion === null
            ? null
            : {
                id: deletion.id,
                state: deletion.state,
                requested_at: deletion.created_at,
                decided_at: deletion.decided_at,
              },
      },
      200,
    );
  });
}
