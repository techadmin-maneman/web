// Each client's Care person, behind Access (Customer Care; docs/decisions/0131-care-people.md).

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { actorOf, staffMemberOf } from "../../http/audit.ts";
import { moveCarePerson } from "../../domain/care/care-people.ts";
import { careRota } from "../../domain/care/cover.ts";
import { indiaDate } from "../../lib/india-time.ts";

const MemberSchema = z
  .object({
    email: z.string(),
    on_team: z.boolean().openapi({ description: "False for someone no longer on the team who still has clients." }),
    name: z.union([z.string(), z.null()]).openapi({ description: "The first name clients know them by." }),
    clients: z.number().int(),
    weekly_off: z.array(z.number().int()).openapi({ description: "Weekly days off, 0 Sunday to 6 Saturday." }),
    leave: z.array(z.object({ id: z.uuid(), from: z.iso.date(), to: z.iso.date() }).strict()),
    off_today: z.boolean().openapi({ description: "Not answering now: off shift, or on a day off or leave." }),
    on_shift_since: z.union([z.iso.datetime(), z.null()]),
    day_off: z.boolean().openapi({ description: "A weekly day off or leave today." }),
    open_chats: z.number().int(),
    covered_by: z.union([z.string(), z.null()]).openapi({
      description: "Who covers them today; null while they are on, or the whole team is off.",
    }),
  })
  .strict()
  .openapi("CareMember");

const teamRoute = opsRoute({
  method: "get",
  path: "/api/care-team",
  summary: "The Care team, the fewest clients first, with each one's days off and who covers them today",
  responses: {
    200: {
      description: "The team",
      ...json(
        z
          .object({
            team: z.array(MemberSchema),
            me: z
              .union([z.string(), z.null()])
              .openapi({ description: "The caller, by e-mail; null for a service token." }),
          })
          .strict()
          .openapi("CareTeam"),
      ),
    },
  },
});

const moveRoute = opsRoute({
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
    404: errorResponse("not_found: no such client, or their record is erased"),
  },
});

export function registerOpsCarePeople(app: App): void {
  app.openapi(teamRoute, async (c) => {
    const team = await careRota(c.env.DB, indiaDate(c.var.deps.now()));
    return c.json({ team, me: staffMemberOf(c)?.id ?? null }, 200);
  });

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
