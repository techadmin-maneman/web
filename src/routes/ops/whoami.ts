// Who is signed in to the ops console, behind Access.
//
// The console holds no session of its own (docs/decisions/0031-access-and-audit.md),
// so it cannot know who is working unless it asks. The design draws them at the
// header's right; the way out is Access's own logout, which ends the only
// session there is. With them come the cities the header's picker narrows every
// page to (ADR 0225): names alone, which each page's own call keeps to the
// caller's places.

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import { boardCities } from "../../domain/cities/cities.ts";
import type { App } from "../../http/context.ts";
import { callerAccess } from "../../http/staff-access.ts";
import { routesOpenTo } from "../../policy/console-routes.ts";
import { placesSeen, type PlacesReached } from "../../policy/access.ts";
import { grantJson, GrantSchema } from "./staff.ts";

/** Access's own path on every host it guards: it ends the session and shows the team's page. */
const ACCESS_LOGOUT_PATH = "/cdn-cgi/access/logout";

const whoamiRoute = opsRoute({
  method: "get",
  path: "/api/whoami",
  summary: "Who Access let through, and where signing out goes",
  responses: {
    200: {
      description: "The signed-in identity",
      content: {
        "application/json": {
          schema: z
            .object({
              signed_in_as: z.string().openapi({ description: "A member of staff's e-mail, or a service token's ID." }),
              sign_out: z
                .union([z.string(), z.null()])
                .openapi({ description: "Access's logout path; null where no Access stands in front, as locally." }),
              staff: z
                .object({
                  enforced: z.boolean().openapi({ description: "Whether the Staff list decides what they may open." }),
                  listed: z.boolean().openapi({
                    description: "An active person on the Staff list, or a service token on its list of tokens.",
                  }),
                  grants: z.array(GrantSchema).openapi({ description: "A person's grants; none for a service token." }),
                  may_call: z.array(z.string()).openapi({
                    description:
                      'The ops routes their calls go ahead on, as "GET /api/tasks": every one while the list is not ' +
                      "enforced. The console shows only the sections whose pages they can read.",
                    example: ["GET /api/health", "GET /api/whoami", "GET /api/tasks"],
                  }),
                })
                .strict(),
              cities: z.array(z.string()).openapi({
                description:
                  "The cities the header's picker offers, in the console's order: each city ops serve or with a technician " +
                  "at work that the caller's grants reach, every one for a grant that reaches everywhere.",
                example: ["Gurgaon", "Delhi"],
              }),
              every_city: z.boolean().openapi({
                description:
                  "Whether the caller's grants reach every city, so the picker offers them all at once; a person whose " +
                  "grants keep to one city has that city alone.",
              }),
            })
            .strict()
            .openapi("Whoami"),
        },
      },
    },
  },
});

/**
 * The cities the picker offers: every city served or with a technician at work, for a person whose grants reach
 * everywhere; else those of them their grants reach, then any other city a grant names, by name.
 */
function citiesSeen(all: readonly string[], seen: PlacesReached): string[] {
  if (seen.kind === "everywhere") return [...all];
  const listed = all.filter((city) => seen.cities.has(city));
  const others = [...seen.cities].filter((city) => !all.includes(city)).sort((one, other) => one.localeCompare(other));
  return [...listed, ...others];
}

export function registerOpsWhoami(app: App): void {
  app.openapi(whoamiRoute, async (c) => {
    const identity = c.var.accessIdentity;
    if (identity === undefined) throw new Error("ops routes run after requireAccess");
    const signedInAs = identity.kind === "staff" ? identity.email : identity.clientId;
    const signOut = c.var.config.settings.access === null ? null : ACCESS_LOGOUT_PATH;
    const { enforced, caller, zoneOf } = await callerAccess(c);
    const mayCall = routesOpenTo(caller, enforced, zoneOf);
    const staff =
      caller.kind === "person"
        ? { enforced, listed: caller.active, grants: caller.grants.map(grantJson), may_call: mayCall }
        : { enforced, listed: caller.allowed, grants: [], may_call: mayCall };
    const seen = placesSeen(await callerAccess(c));
    const cities = citiesSeen(await boardCities(c.env.DB), seen);
    const answer = {
      signed_in_as: signedInAs,
      sign_out: signOut,
      staff,
      cities,
      every_city: seen.kind === "everywhere",
    };
    return c.json(answer, 200);
  });
}
