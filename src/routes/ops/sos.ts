// A technician's SOS on the console (docs/decisions/0248-safety.md): every SOS not yet handled, which every console
// screen shows as a banner to anyone signed in, with whose it is, the visit they were on and a map; and marking one
// handled, behind Operations · Act, which keeps who and when and blanks where the technician was.

import { z } from "@hono/zod-openapi";
import { handleSos, openSosList } from "../../domain/field/safety.ts";
import { actorOf } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { opsRoute } from "../../http/session-routes.ts";

const OpenSosSchema = z
  .object({
    id: z.uuid(),
    technician: z.object({ id: z.string(), name: z.string() }).strict(),
    visit: z
      .object({ id: z.string(), starts_at: z.iso.datetime(), client_name: z.string().nullable() })
      .strict()
      .nullable(),
    position: z
      .object({ lat: z.number(), lng: z.number(), accuracy_m: z.number().nullable(), at: z.iso.datetime() })
      .strict()
      .nullable()
      .openapi({ description: "Where the technician was last heard, while the SOS is open." }),
    sent_at: z.iso.datetime(),
    safe_at: z.iso.datetime().nullable().openapi({ description: "When the technician said they are safe." }),
  })
  .strict()
  .openapi("OpenSos");

const openRoute = opsRoute({
  method: "get",
  path: "/api/sos",
  summary: "Every technician's SOS not yet handled, oldest first, for the banner on every console screen",
  responses: {
    200: { description: "Open, oldest first", ...json(z.object({ open: z.array(OpenSosSchema) }).strict()) },
  },
});

const handledRoute = opsRoute({
  method: "post",
  path: "/api/sos/{id}/handled",
  summary: "Mark an SOS handled: who and when are kept, and where the technician was is blanked",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    204: { description: "Handled" },
    404: errorResponse("not_found: no such SOS still open"),
  },
});

export function registerOpsSos(app: App): void {
  app.openapi(openRoute, async (c) => c.json({ open: await openSosList(c.env.DB) }, 200));

  app.openapi(handledRoute, async (c) => {
    const id = c.req.valid("param").id;
    const handled = await handleSos(c.env.DB, { id, by: actorOf(c).id, now: c.var.deps.now() });
    if (handled === "not_found") return refuse(c, "not_found");
    await c.var.deps.resolveAlert(`sos:${id}`);
    await c.var.deps.resolveAlert(`sos_safe:${id}`);
    c.var.log.info("sos_handled", { sos_id: id });
    return c.body(null, 204);
  });
}
