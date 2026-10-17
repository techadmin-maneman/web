// A client's data for them, from the console (docs/decisions/0049-dpdp.md): the readable copy the app downloads, for a
// client who asks Care on WhatsApp or the phone. Customer Care manage, within the caller's cities, audited under the
// member of staff before anything is read, so an export the log could not record is never given.

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import type { App } from "../../http/context.ts";
import { recordAudit } from "../../domain/platform/audit.ts";
import { readPersonData } from "../../domain/privacy/data-export.ts";
import { myDataPage } from "../../domain/privacy/my-data-page.ts";
import { actorOf } from "../../http/audit.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { clientInReach } from "../../http/staff-access.ts";

const clientExportRoute = opsRoute({
  method: "get",
  path: "/api/clients/{id}/export.html",
  summary: "Everything held about a client, as the page their app downloads, for Care to send them",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: {
      description: "An HTML file, maneman-client-data.html, labelled and in India's time",
      content: { "text/html": { schema: z.string() } },
    },
    404: errorResponse("not_found: no such client, or one erased, in the caller's cities"),
  },
});

export function registerOpsClientExport(app: App): void {
  app.openapi(clientExportRoute, async (c) => {
    const { id } = c.req.valid("param");
    if ((await clientInReach(c, id)) === null) return refuse(c, "not_found");
    const now = c.var.deps.now();
    await recordAudit(
      c.env.DB,
      {
        surface: "ops",
        actor: actorOf(c),
        action: "data.export",
        subject: { kind: "person", id },
        requestId: c.var.requestId,
      },
      now,
    );
    const held = await readPersonData(c.env.DB, c.env.BACKUPS, id);
    return new Response(myDataPage(held, now), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": 'attachment; filename="maneman-client-data.html"',
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
        "Cache-Control": "private, no-store",
      },
    });
  });
}
