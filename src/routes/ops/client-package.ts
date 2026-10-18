// The package a client is on, from their record in the console (docs/decisions/0211-packages.md): ops put them on
// another, as at a replacement. Their service visits, replacements and when each falls due follow it from then.

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import { setClientPackage } from "../../domain/clients/client-package.ts";
import { actorOf } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { clientInReach } from "../../http/staff-access.ts";
import { PRICE_TIER } from "../../policy/services.ts";

const setRoute = opsRoute({
  method: "post",
  path: "/api/clients/{id}/package",
  summary: "Put a client on a package. Their next service visit and replacement follow it",
  request: {
    params: z.object({ id: z.uuid() }),
    body: {
      required: true,
      ...json(
        z
          .object({ package: z.string().regex(PRICE_TIER) })
          .strict()
          .openapi("ClientPackage"),
      ),
    },
  },
  responses: {
    200: { description: "Put on it", ...json(z.object({ package: z.string() }).strict()) },
    404: errorResponse("not_found: no such client within the caller's cities, or no such package"),
  },
});

export function registerOpsClientPackage(app: App): void {
  app.openapi(setRoute, async (c) => {
    const { id } = c.req.valid("param");
    if ((await clientInReach(c, id)) === null) return refuse(c, "not_found");
    const code = c.req.valid("json").package;
    const set = await setClientPackage(c.env.DB, {
      actor: actorOf(c),
      requestId: c.var.requestId,
      now: c.var.deps.now(),
      personId: id,
      code,
    });
    if (set === "not_found") return refuse(c, "not_found");
    return c.json({ package: code }, 200);
  });
}
