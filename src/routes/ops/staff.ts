// The Staff page, behind Access (Settings · Staff):
//   GET  /api/staff                          the people on the list and their grants, the service tokens let in, and
//                                            whether the list is enforced; narrowed to the caller's own places
//   POST /api/staff                          a member of staff added, or their grants and whether they are let in
//   POST /api/staff/delete                   a member of staff taken off the list, with their grants
//   POST /api/staff/enforcement              the list enforced, or not
//   POST /api/staff/service-tokens           a service token let in, as every caller was before the list
//   POST /api/staff/service-tokens/remove    a service token taken off
//
// Every change is audited under the person who made it, in the same batch (src/domain/ops/staff.ts).

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { routePath } from "hono/route";
import { actorOf } from "../../http/audit.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { callerAccess, goesAhead } from "../../http/staff-access.ts";
import {
  addServiceToken,
  readStaffBook,
  removeServiceToken,
  deleteStaffMember,
  saveStaffMember,
  setEnforced,
  type StaffBook,
} from "../../domain/ops/staff.ts";
import {
  can,
  DEPARTMENTS,
  GEOGRAPHIES,
  leavesNoNationalAdmin,
  LEVELS,
  mayEdit,
  mayRunAccess,
  maySee,
  NATIONAL,
  samePlace,
  type CallerAccess,
  type Grant,
  type Place,
} from "../../policy/access.ts";

export const GrantSchema = z
  .object({
    department: z.enum(DEPARTMENTS),
    level: z
      .enum(LEVELS)
      .openapi({ description: "view < act < manage: each level can do what the ones before it can." }),
    geography: z.enum(GEOGRAPHIES),
    place: z
      .union([z.string().trim().min(1).max(60), z.null()])
      .openapi({ description: "The zone's or the city's name; null for national." }),
  })
  .strict()
  .openapi("StaffGrant");

type GrantJson = z.infer<typeof GrantSchema>;

export function grantJson(grant: Grant): GrantJson {
  const place = grant.place.geography === "national" ? null : grant.place.name;
  return { department: grant.department, level: grant.level, geography: grant.place.geography, place };
}

const StaffBookSchema = z
  .object({
    enforced: z
      .object({
        on: z.boolean().openapi({ description: "Off: nothing is refused, and what would have been is logged." }),
        set_by: z.union([z.string(), z.null()]),
        set_at: z.union([z.iso.datetime(), z.null()]),
      })
      .strict(),
    may_run_access: z.boolean().openapi({
      description:
        "Whether the caller may switch enforcement and change the service tokens: a person with Admin MANAGE nationally.",
    }),
    people: z.array(
      z
        .object({
          email: z.string(),
          active: z.boolean(),
          grants: z.array(GrantSchema),
          added_by: z.string(),
          added_at: z.iso.datetime(),
          changed_by: z.union([z.string(), z.null()]),
          changed_at: z.union([z.iso.datetime(), z.null()]),
        })
        .strict(),
    ),
    service_tokens: z.array(
      z.object({ client_id: z.string(), label: z.string(), added_by: z.string(), added_at: z.iso.datetime() }).strict(),
    ),
    zones: z.array(z.object({ name: z.string(), cities: z.array(z.string()) }).strict()),
    cities: z.array(z.string()).openapi({ description: "Every city a grant may name." }),
  })
  .strict()
  .openapi("StaffBook");

const SaveSchema = z
  .object({
    email: z.email().max(254).openapi({ description: "Their Cloudflare Access e-mail." }),
    active: z
      .boolean()
      .openapi({ description: "False keeps them listed, with their grants, but lets them in nowhere." }),
    grants: z
      .array(GrantSchema)
      .max(40)
      .openapi({ description: "Every grant they are to hold; this replaces them all." }),
  })
  .strict()
  .openapi("StaffSave");

const TokenSchema = z
  .object({
    client_id: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]{1,100}$/)
      .openapi({ description: "The service token's client ID, as Access names it." }),
    label: z.string().trim().min(1).max(60),
  })
  .strict()
  .openapi("StaffServiceToken");

const book = { 200: { description: "The Staff page as it now stands", ...json(StaffBookSchema) } };

const readRoute = createRoute({
  method: "get",
  path: "/api/staff",
  summary: "The Staff list, narrowed to the caller's own places",
  responses: { ...book, 403: errorResponse("access_required, or not_permitted") },
});

const saveRoute = createRoute({
  method: "post",
  path: "/api/staff",
  summary: "Add a member of staff, or replace their grants and whether they are let in",
  request: { body: { required: true, ...json(SaveSchema) } },
  responses: {
    ...book,
    400: errorResponse("invalid_request: a grant names no place it may, or the same place twice"),
    403: errorResponse(
      "access_required, or not_permitted: the change reaches beyond the caller's Admin MANAGE, or comes from a service token",
    ),
    409: errorResponse("last_admin: nobody would be left with Admin MANAGE nationally"),
  },
});

const deleteRoute = createRoute({
  method: "post",
  path: "/api/staff/delete",
  summary: "Take a member of staff off the list, with their grants. What they did stays in the audit log",
  request: { body: { required: true, ...json(SaveSchema.pick({ email: true }).openapi("StaffDeletion")) } },
  responses: {
    ...book,
    403: errorResponse(
      "access_required, or not_permitted: their grants reach beyond the caller's Admin MANAGE, it is the caller, or a service token asks",
    ),
    404: errorResponse("not_found: nobody on the list has that e-mail"),
    409: errorResponse("last_admin: nobody would be left with Admin MANAGE nationally"),
  },
});

const enforcementRoute = createRoute({
  method: "post",
  path: "/api/staff/enforcement",
  summary: "Enforce the Staff list, or stop",
  request: { body: { required: true, ...json(z.object({ on: z.boolean() }).strict()) } },
  responses: {
    ...book,
    403: errorResponse("access_required, or not_permitted: only a person with Admin MANAGE nationally"),
  },
});

const addTokenRoute = createRoute({
  method: "post",
  path: "/api/staff/service-tokens",
  summary: "Let a service token in, as every caller was before the Staff list",
  request: { body: { required: true, ...json(TokenSchema) } },
  responses: {
    ...book,
    403: errorResponse("access_required, or not_permitted: only a person with Admin MANAGE nationally"),
  },
});

const removeTokenRoute = createRoute({
  method: "post",
  path: "/api/staff/service-tokens/remove",
  summary: "Take a service token off",
  request: { body: { required: true, ...json(TokenSchema.pick({ client_id: true })) } },
  responses: {
    ...book,
    403: errorResponse("access_required, or not_permitted: only a person with Admin MANAGE nationally"),
    404: errorResponse("not_found: no such token is listed"),
  },
});

/** The book as the caller may see it: all of it nationally, or while the list is not enforced, as before it. */
function bookFor(staff: StaffBook, access: CallerAccess) {
  const { caller, zoneOf } = access;
  const seesAll = !access.enforced || can({ caller, department: "admin", level: "view", where: NATIONAL, zoneOf });
  const people = seesAll ? staff.people : staff.people.filter((person) => maySee(caller, person, zoneOf));
  return {
    enforced: { on: staff.mode.enforced, set_by: staff.mode.setBy, set_at: staff.mode.setAt },
    may_run_access: mayRunAccess(caller),
    people: people.map((person) => ({
      email: person.email,
      active: person.active,
      grants: person.grants.map(grantJson),
      added_by: person.addedBy,
      added_at: person.addedAt,
      changed_by: person.changedBy,
      changed_at: person.changedAt,
    })),
    service_tokens: (seesAll ? staff.serviceTokens : []).map((token) => ({
      client_id: token.clientId,
      label: token.label,
      added_by: token.addedBy,
      added_at: token.addedAt,
    })),
    zones: staff.zones.map((zone) => ({ name: zone.name, cities: [...zone.cities] })),
    cities: [...staff.cities],
  };
}

async function currentBook(c: Context<AppEnv>, access: CallerAccess) {
  return bookFor(await readStaffBook(c.env.DB), access);
}

/** A grant as sent, if its place is one a grant may name: none for national, a zone, or an active city. */
function placeOf(sent: GrantJson, staff: StaffBook): Place | null {
  if (sent.geography === "national") return sent.place === null ? NATIONAL : null;
  if (sent.place === null) return null;
  const known =
    sent.geography === "zone"
      ? staff.zones.some((zone) => zone.name === sent.place)
      : staff.cities.includes(sent.place);
  return known ? { geography: sent.geography, name: sent.place } : null;
}

/** The grants sent, or the field to name when one is refused: a place it may not name, or a department's place twice. */
function grantsOf(sent: readonly GrantJson[], staff: StaffBook): { grants: Grant[] } | { field: string } {
  const grants: Grant[] = [];
  for (const [index, each] of sent.entries()) {
    const place = placeOf(each, staff);
    if (place === null) return { field: `grants.${String(index)}.place` };
    const twice = grants.some((held) => held.department === each.department && samePlace(held.place, place));
    if (twice) return { field: `grants.${String(index)}` };
    grants.push({ department: each.department, level: each.level, place });
  }
  return { grants };
}

/** Whether the caller may switch enforcement or change the tokens, asked even while the list is not enforced. */
function runsAccess(c: Context<AppEnv>, access: CallerAccess): boolean {
  if (mayRunAccess(access.caller)) return true;
  const asked = "admin:manage:national";
  c.var.log.warn("staff_access_refused", {
    route: routePath(c, -1),
    method: c.req.method,
    asked,
    caller: access.caller.kind,
  });
  return false;
}

export function registerOpsStaff(app: App): void {
  app.openapi(readRoute, async (c) => c.json(await currentBook(c, await callerAccess(c)), 200));

  app.openapi(saveRoute, async (c) => {
    const sent = c.req.valid("json");
    const email = sent.email.toLowerCase();
    const staff = await readStaffBook(c.env.DB);
    const checked = grantsOf(sent.grants, staff);
    if ("field" in checked) return refuse(c, "invalid_request", [checked.field]);

    const access = await callerAccess(c);
    // A grant is given by a person: a service token is refused even while the list is not enforced.
    if (access.caller.kind === "service") return refuse(c, "not_permitted");
    const entry = { active: sent.active, grants: checked.grants };
    const before = staff.people.find((person) => person.email === email) ?? null;
    const allowed = mayEdit(access.caller, before, entry, staff.zoneOf);
    if (!goesAhead(c, access, allowed, "admin:manage:places")) {
      return refuse(c, "not_permitted");
    }
    if (leavesNoNationalAdmin(staff.people, email, entry)) {
      return refuse(c, "last_admin");
    }

    await saveStaffMember(c.env.DB, {
      email,
      entry,
      before,
      actor: actorOf(c),
      requestId: c.var.requestId,
      now: c.var.deps.now(),
    });
    return c.json(await currentBook(c, access), 200);
  });

  app.openapi(deleteRoute, async (c) => {
    const email = c.req.valid("json").email.toLowerCase();
    const staff = await readStaffBook(c.env.DB);
    const before = staff.people.find((person) => person.email === email);
    if (before === undefined) return refuse(c, "not_found");

    const access = await callerAccess(c);
    // Nobody takes themselves off: they would be locked out by their own hand.
    if (access.caller.kind === "service" || actorOf(c).id.toLowerCase() === email) return refuse(c, "not_permitted");
    const gone = { active: false, grants: [] };
    if (!goesAhead(c, access, mayEdit(access.caller, before, gone, staff.zoneOf), "admin:manage:places")) {
      return refuse(c, "not_permitted");
    }
    if (leavesNoNationalAdmin(staff.people, email, gone)) return refuse(c, "last_admin");

    await deleteStaffMember(c.env.DB, {
      email,
      before,
      actor: actorOf(c),
      requestId: c.var.requestId,
      now: c.var.deps.now(),
    });
    return c.json(await currentBook(c, access), 200);
  });

  app.openapi(enforcementRoute, async (c) => {
    const access = await callerAccess(c);
    if (!runsAccess(c, access)) return refuse(c, "not_permitted");
    await setEnforced(c.env.DB, {
      enforced: c.req.valid("json").on,
      actor: actorOf(c),
      requestId: c.var.requestId,
      now: c.var.deps.now(),
    });
    return c.json(await currentBook(c, access), 200);
  });

  app.openapi(addTokenRoute, async (c) => {
    const access = await callerAccess(c);
    if (!runsAccess(c, access)) return refuse(c, "not_permitted");
    const { client_id: clientId, label } = c.req.valid("json");
    await addServiceToken(c.env.DB, {
      clientId,
      label,
      actor: actorOf(c),
      requestId: c.var.requestId,
      now: c.var.deps.now(),
    });
    return c.json(await currentBook(c, access), 200);
  });

  app.openapi(removeTokenRoute, async (c) => {
    const access = await callerAccess(c);
    if (!runsAccess(c, access)) return refuse(c, "not_permitted");
    const removed = await removeServiceToken(c.env.DB, {
      clientId: c.req.valid("json").client_id,
      actor: actorOf(c),
      requestId: c.var.requestId,
      now: c.var.deps.now(),
    });
    if (!removed) return refuse(c, "not_found");
    return c.json(await currentBook(c, access), 200);
  });
}
