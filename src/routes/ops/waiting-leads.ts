// The unanswered-lead alert, behind Access (Customer Care; docs/decisions/0323-the-unanswered-lead-alert.md): the leads
// who wrote to us and wait past their alert time for Care's first reply, which every console screen shows a Care person
// on shift; and the phone that takes their pushes.

import { z } from "@hono/zod-openapi";
import { opsRoute } from "../../http/session-routes.ts";
import type { App } from "../../http/context.ts";
import { staffMemberOf } from "../../http/audit.ts";
import { json } from "../../http/openapi.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { isOnShift } from "../../domain/care/cover.ts";
import { waitingLeads } from "../../domain/leads/waiting-leads.ts";
import { keepStaffPhone } from "../../domain/leads/lead-alerts.ts";
import { DAY_MS } from "../../lib/durations.ts";
import { isPushEndpoint } from "../../providers/web-push.ts";

const instant = z.iso.datetime();

const LeadSchema = z
  .object({
    conversation_id: z.string().openapi({ description: "The chat waiting on Care's first reply." }),
    person_id: z.union([z.string(), z.null()]).openapi({ description: "Null for a number we don't know." }),
    name: z.union([z.string(), z.null()]),
    mobile: z.string().openapi({ description: "The number the chat came from." }),
    since: instant.openapi({ description: "Their first message since the chat last opened." }),
    alert_at: instant.openapi({ description: "When it had waited the alert minutes in Care hours." }),
  })
  .strict()
  .openapi("WaitingLead");

const waitingRoute = opsRoute({
  method: "get",
  path: "/api/leads/waiting",
  summary: "The leads past their alert time, the longest waiting first, and whether the caller is on Care shift",
  responses: {
    200: {
      description: "The leads",
      ...json(
        z
          .object({
            on_shift: z
              .boolean()
              .openapi({ description: "Whether the caller is on Care shift, whom the banner is for." }),
            leads: z.array(LeadSchema),
            push_key: z.union([z.string(), z.null()]).openapi({
              description: "The key a phone subscribes to pushes with; null where pushes are not set up.",
            }),
          })
          .strict(),
      ),
    },
  },
});

const phoneRoute = opsRoute({
  method: "post",
  path: "/api/leads/alerts-phone",
  summary: "This phone takes the caller's unanswered-lead pushes, by its push service's address",
  request: { body: { required: true, ...json(z.object({ endpoint: z.string().max(2048) }).strict()) } },
  responses: {
    204: { description: "Kept" },
    400: errorResponse("invalid_request: endpoint is not a push service's address"),
    403: errorResponse("not_permitted: the caller is not on the Staff list"),
  },
});

export function registerOpsWaitingLeads(app: App): void {
  app.openapi(waitingRoute, async (c) => {
    const now = c.var.deps.now();
    const { careHours, taskLapseDays } = await opsInputs(c);
    const me = staffMemberOf(c)?.id ?? "";
    const [onShift, leads] = await Promise.all([
      isOnShift(c.env.DB, me),
      waitingLeads(c.env.DB, { from: new Date(now.getTime() - taskLapseDays * DAY_MS), hours: careHours }),
    ]);
    const at = now.toISOString();
    return c.json(
      {
        on_shift: onShift,
        leads: leads.filter((lead) => lead.alert_at <= at).map(({ wait: _wait, ...lead }) => lead),
        push_key: c.var.config.settings.push?.publicKey ?? null,
      },
      200,
    );
  });

  app.openapi(phoneRoute, async (c) => {
    const { endpoint } = c.req.valid("json");
    if (!isPushEndpoint(endpoint)) return refuse(c, "invalid_request", ["endpoint"]);
    const kept = await keepStaffPhone(c.env.DB, { email: staffMemberOf(c)?.id ?? "", endpoint, now: c.var.deps.now() });
    return kept ? c.body(null, 204) : refuse(c, "not_permitted");
  });
}
