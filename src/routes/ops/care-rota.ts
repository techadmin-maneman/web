// The Care team's days off, behind Access (Customer Care Manage; docs/decisions/0134-care-cover.md):
// The team as it stands, with who covers whom today, is GET /api/care-team (./care-people.ts).

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { actorOf, staffMemberOf } from "../../http/audit.ts";
import { careTeam, moveAllClients, setCareName } from "../../domain/care/care-people.ts";
import { addLeave, deleteLeave, setOnShift, setWeeklyOff } from "../../domain/care/cover.ts";
import { indiaDate } from "../../lib/india-time.ts";

const DATE = z.iso.date();
const done = { description: "Done", ...json(z.object({ ok: z.literal(true) }).strict()) };
const notCare = errorResponse("invalid_request: fields names email when it is not one of the Care team");

const daysOffRoute = createRoute({
  method: "post",
  path: "/api/care-team/days-off",
  summary: "A Care team member's weekly days off, replaced whole",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({ email: z.email(), weekdays: z.array(z.number().int().min(0).max(6)).max(6) })
          .strict()
          .openapi("CareDaysOff"),
      ),
    },
  },
  responses: { 200: done, 400: notCare, 403: errorResponse("access_required") },
});

const leaveRoute = createRoute({
  method: "post",
  path: "/api/care-team/leave",
  summary: "Leave for a Care team member, from one India date to another, both included",
  request: {
    body: {
      required: true,
      ...json(z.object({ email: z.email(), from: DATE, to: DATE }).strict().openapi("CareLeave")),
    },
  },
  responses: {
    200: { description: "The leave", ...json(z.object({ id: z.uuid() }).strict()) },
    400: errorResponse(
      "invalid_request: fields names email when it is not one of the Care team, and to when it is before from or today",
    ),
    403: errorResponse("access_required"),
  },
});

const deleteRoute = createRoute({
  method: "post",
  path: "/api/care-team/leave/{id}/delete",
  summary: "Leave taken back",
  request: { params: z.object({ id: z.uuid() }) },
  responses: { 200: done, 403: errorResponse("access_required"), 404: errorResponse("not_found") },
});

const nameRoute = createRoute({
  method: "post",
  path: "/api/care-team/name",
  summary: "The first name a Care team member is known by to clients, as their Support card shows it",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({ email: z.email(), name: z.string().trim().min(1).max(40) })
          .strict()
          .openapi("CareName"),
      ),
    },
  },
  responses: { 200: done, 400: notCare, 403: errorResponse("access_required") },
});

const shiftRoute = createRoute({
  method: "post",
  path: "/api/care-team/shift",
  summary: "Go on shift, or off it: the caller, as a member of the Care team",
  request: { body: { required: true, ...json(z.object({ on: z.boolean() }).strict().openapi("CareShift")) } },
  responses: {
    200: done,
    400: errorResponse("invalid_request: fields names on when the caller is not one of the Care team"),
    403: errorResponse("access_required"),
  },
});

const moveAllRoute = createRoute({
  method: "post",
  path: "/api/care-team/move-all",
  summary: "Move every client of one member to another of the Care team, as when someone leaves",
  request: {
    body: {
      required: true,
      ...json(z.object({ from: z.email(), to: z.email() }).strict().openapi("CareMoveAll")),
    },
  },
  responses: {
    200: { description: "How many moved", ...json(z.object({ moved: z.number().int() }).strict()) },
    400: errorResponse("invalid_request: fields names to when it is not one of the Care team, or the same as from"),
    403: errorResponse("access_required"),
  },
});

const changeOf = (c: Context<AppEnv>) => ({ actor: actorOf(c), requestId: c.var.requestId, now: c.var.deps.now() });

const onTheTeam = async (c: Context<AppEnv>, email: string) =>
  (await careTeam(c.env.DB)).some((member) => member.email === email);

export function registerOpsCareRota(app: App): void {
  app.openapi(daysOffRoute, async (c) => {
    const { email, weekdays } = c.req.valid("json");
    if (!(await onTheTeam(c, email))) return refuse(c, "invalid_request", ["email"]);
    await setWeeklyOff(c.env.DB, { ...changeOf(c), email, weekdays: [...new Set(weekdays)].sort() });
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(leaveRoute, async (c) => {
    const { email, from, to } = c.req.valid("json");
    if (!(await onTheTeam(c, email))) return refuse(c, "invalid_request", ["email"]);
    if (to < from || to < indiaDate(c.var.deps.now())) return refuse(c, "invalid_request", ["to"]);
    return c.json({ id: await addLeave(c.env.DB, { ...changeOf(c), email, from, to }) }, 200);
  });

  app.openapi(nameRoute, async (c) => {
    const { email, name } = c.req.valid("json");
    if (!(await onTheTeam(c, email))) return refuse(c, "invalid_request", ["email"]);
    await setCareName(c.env.DB, { ...changeOf(c), email, name });
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(shiftRoute, async (c) => {
    const me = staffMemberOf(c)?.id ?? "";
    if (!(await onTheTeam(c, me))) return refuse(c, "invalid_request", ["on"]);
    await setOnShift(c.env.DB, me, c.req.valid("json").on, c.var.deps.now());
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(moveAllRoute, async (c) => {
    const { from, to } = c.req.valid("json");
    const moved = await moveAllClients(c.env.DB, { ...changeOf(c), from, to });
    return moved === "not_care" ? refuse(c, "invalid_request", ["to"]) : c.json({ moved }, 200);
  });

  app.openapi(deleteRoute, async (c) => {
    const deleted = await deleteLeave(c.env.DB, { ...changeOf(c), id: c.req.valid("param").id });
    return deleted ? c.json({ ok: true as const }, 200) : refuse(c, "not_found");
  });
}
