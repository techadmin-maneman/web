// Each client's Care person, behind Access (Customer Care; docs/decisions/0131-care-people.md):
//   GET /api/care-team                  the Care team, each with how many clients are theirs
//   POST /api/clients/:id/care-person   a client moved to another of the team, as a Customer Care manager does

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { actorOf } from "../../http/audit.ts";
import { careTeam, moveCarePerson } from "../../domain/care/care-people.ts";

const teamRoute = createRoute({
  method: "get",
  path: "/api/care-team",
  summary: "The Care team, each with how many clients are theirs, the fewest first",
  responses: {
    200: {
      description: "The team",
      ...json(
        z
          .object({ team: z.array(z.object({ email: z.string(), clients: z.number().int() }).strict()) })
          .strict()
          .openapi("CareTeam"),
      ),
    },
    403: errorResponse("access_required"),
  },
});

const moveRoute = createRoute({
  method: "post",
  path: "/api/clients/{id}/care-person",
  summary: "Move a client to another member of the Care team",
  request: {
    params: z.object({ id: z.uuid() }),
    body: {
      required: true,
      ...json(z.object({ email: z.email() }).strict().openapi("CarePersonMove")),
    },
  },
  responses: {
    200: {
      description: "The client's Care person now",
      ...json(z.object({ care_person: z.string() }).strict().openapi("CarePerson")),
    },
    400: errorResponse("invalid_request: fields names email when it is not one of the Care team"),
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such client, or their record is erased"),
  },
});

export function registerOpsCarePeople(app: App): void {
  app.openapi(teamRoute, async (c) => c.json({ team: await careTeam(c.env.DB) }, 200));

  app.openapi(moveRoute, async (c) => {
    const { email } = c.req.valid("json");
    const moved = await moveCarePerson(c.env.DB, {
      personId: c.req.valid("param").id,
      email,
      actor: actorOf(c),
      requestId: c.var.requestId,
      now: c.var.deps.now(),
    });
    if (moved === "not_found") return refuse(c, "not_found");
    if (moved === "not_care") return refuse(c, "invalid_request", ["email"]);
    return c.json({ care_person: email }, 200);
  });
}
