// The Care numbers, behind Access (Customer Care; docs/decisions/0144-care-numbers.md).

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../../http/context.ts";
import { errorResponse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { careNumbers } from "../../domain/care/care-numbers.ts";

const PERIODS = ["7", "30", "90"] as const;

const Replies = {
  chats: z.number().int(),
  median_minutes: z.union([z.number().int(), z.null()]).openapi({
    description: "The middle first reply, in minutes counted in Care hours; null with none answered.",
  }),
  within_target: z.union([z.number(), z.null()]).openapi({
    description: "The share of chats answered by their reply-by time, 0 to 1; null with none.",
  }),
};

const NumbersSchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    replies: z.object(Replies).strict(),
    same_day: z.union([z.number(), z.null()]).openapi({ description: "The share closed the day they opened." }),
    backlog: z
      .object({ waiting_on_us: z.number().int(), overdue: z.number().int(), waiting_on_client: z.number().int() })
      .strict(),
    reasons: z.array(z.object({ reason: z.string(), chats: z.number().int() }).strict()),
    remedies: z.array(z.object({ reason: z.string(), remedies: z.number().int(), visits: z.number().int() }).strict()),
    by_person: z.array(z.object({ email: z.string(), ...Replies }).strict()),
  })
  .strict()
  .openapi("CareNumbers");

const numbersRoute = createRoute({
  method: "get",
  path: "/api/care-numbers",
  summary: "Whether the same-day promise holds: reply times, same-day closes, the backlog, reasons and remedies",
  request: { query: z.object({ days: z.enum(PERIODS).default("7") }) },
  responses: {
    200: { description: "The numbers", ...json(NumbersSchema) },
    403: errorResponse("access_required"),
  },
});

export function registerOpsCareNumbers(app: App): void {
  app.openapi(numbersRoute, async (c) => {
    const { careHours } = await opsInputs(c);
    const days = Number(c.req.valid("query").days);
    return c.json(await careNumbers(c.env.DB, days, careHours, c.var.deps.now()), 200);
  });
}
