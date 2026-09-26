// Who is signed in to the ops console, behind Access:
//   GET /api/whoami    the identity Access let through, and where signing out goes
//
// The console holds no session of its own (docs/decisions/0031-access-and-audit.md),
// so it cannot know who is working unless it asks. Board A1 draws them at the
// header's right; the way out is Access's own logout, which ends the only
// session there is.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../app.ts";

/** Access's own path on every host it guards: it ends the session and shows the team's page. */
export const ACCESS_LOGOUT_PATH = "/cdn-cgi/access/logout";

const whoamiRoute = createRoute({
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
            })
            .strict()
            .openapi("Whoami"),
        },
      },
    },
  },
});

export function registerOpsWhoami(app: App): void {
  app.openapi(whoamiRoute, (c) => {
    const identity = c.var.accessIdentity;
    if (identity === undefined) throw new Error("ops routes run after requireAccess");
    const signedInAs = identity.kind === "staff" ? identity.email : identity.clientId;
    const signOut = c.var.config.settings.access === null ? null : ACCESS_LOGOUT_PATH;
    return c.json({ signed_in_as: signedInAs, sign_out: signOut }, 200);
  });
}
