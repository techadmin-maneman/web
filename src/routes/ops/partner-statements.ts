// Partners' monthly statements, behind Access (Finance; docs/decisions/0124-partner-statements.md).

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { actorOf } from "../../http/audit.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { addMonths, indiaDate, monthOf } from "../../lib/india-time.ts";
import {
  deletePayout,
  firstPartnerMonth,
  partnerStatements,
  recordPayout,
} from "../../domain/referrals/partner-statements.ts";

/** The most one month's payment may be, in paise: a guard against a figure typed a hundred times too big. */
const MAX_PAYOUT = 100_000_000;

const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** A payout tool's reference: a UTR, or a payout's ID. */
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,59}$/;

const StatementSchema = z
  .object({
    channel_id: z.uuid(),
    name: z.string(),
    code: z.string(),
    fitted: z.number().int().openapi({ description: "Friends fitted in the month." }),
    earned: z.number().int().openapi({ description: "Paise they earned, at the commission in force for each." }),
    taken_back: z
      .number()
      .int()
      .openapi({ description: "Friends whose first fit a refund under the guarantee took back in the month." }),
    taken_back_amount: z.number().int().openapi({ description: "Paise taken back with them." }),
    due: z.number().int().openapi({ description: "What the month came to: earned, less taken back. May be below 0." }),
    payout: z.union([
      z
        .object({ amount: z.number().int(), paid_on: z.iso.date(), reference: z.string(), recorded_by: z.string() })
        .strict(),
      z.null(),
    ]),
    owed: z.number().int().openapi({ description: "Paise owed to date, this month and every other." }),
    lines: z
      .array(
        z
          .object({
            day: z.iso.date(),
            kind: z.enum(["fitted", "taken_back"]),
            commission: z.number().int(),
          })
          .strict(),
      )
      .openapi({ description: "Each fit and each taking back, by day in India: days and amounts, never a client." }),
  })
  .strict();

const StatementsSchema = z
  .object({
    month: Month,
    today: z.iso.date(),
    this_month: Month,
    first_month: Month.openapi({ description: "The month the first partner was added in." }),
    max_amount: z.number().int(),
    statements: z.array(StatementSchema),
  })
  .strict()
  .openapi("PartnerStatements");

const ok = { description: "The month's statements, as they now stand", ...json(StatementsSchema) };
const Id = z.object({ id: z.uuid() });

const listRoute = opsRoute({
  method: "get",
  path: "/api/partner-statements",
  summary: "Each partner's month, and what each is owed",
  request: {
    query: z.object({
      month: Month.optional().openapi({ description: "Last month, the one to pay, when left out." }),
    }),
  },
  responses: { 200: ok, 400: errorResponse("invalid_request"), 403: errorResponse("access_required") },
});

const recordRoute = opsRoute({
  method: "post",
  path: "/api/partner-statements/{id}/payouts",
  summary: "Record a month's payment to a partner, made from the payout tool",
  request: {
    params: Id,
    body: {
      required: true,
      ...json(
        z
          .object({
            month: Month,
            amount: z.number().int().min(0).max(MAX_PAYOUT),
            paid_on: z.iso.date(),
            reference: z.string().trim().regex(REFERENCE),
          })
          .strict()
          .openapi("PartnerPayout"),
      ),
    },
  },
  responses: {
    200: ok,
    400: errorResponse("invalid_request: fields names month (one that has ended), amount, paid_on or reference"),
    404: errorResponse("not_found"),
    409: errorResponse("taken: the month's payment is already recorded"),
  },
});

const deleteRoute = opsRoute({
  method: "post",
  path: "/api/partner-statements/{id}/payouts/{month}/delete",
  summary: "Take off a payment recorded by mistake; the month is owed again",
  request: { params: Id.extend({ month: Month }) },
  responses: { 200: ok, 403: errorResponse("access_required"), 404: errorResponse("not_found") },
});

export function registerOpsPartnerStatements(app: App): void {
  const answer = async (c: Context<AppEnv>, month: string) => {
    const now = c.var.deps.now();
    return {
      month,
      today: indiaDate(now),
      this_month: monthOf(indiaDate(now)),
      first_month: await firstPartnerMonth(c.env.DB, now),
      max_amount: MAX_PAYOUT,
      statements: await partnerStatements(c.env.DB, month),
    };
  };
  const change = (c: Context<AppEnv>) => ({ actor: actorOf(c), requestId: c.var.requestId, now: c.var.deps.now() });

  app.openapi(listRoute, async (c) => {
    const month = c.req.valid("query").month ?? addMonths(monthOf(indiaDate(c.var.deps.now())), -1);
    return c.json(await answer(c, month), 200);
  });

  app.openapi(recordRoute, async (c) => {
    const body = c.req.valid("json");
    const today = indiaDate(c.var.deps.now());
    if (body.month >= monthOf(today)) return refuse(c, "invalid_request", ["month"]);
    if (body.paid_on < `${body.month}-01` || body.paid_on > today) return refuse(c, "invalid_request", ["paid_on"]);
    const recorded = await recordPayout(c.env.DB, {
      ...change(c),
      channelId: c.req.valid("param").id,
      month: body.month,
      amount: body.amount,
      paidOn: body.paid_on,
      reference: body.reference,
    });
    if (recorded === "not_found") return refuse(c, "not_found");
    if (recorded === "taken") return refuse(c, "taken");
    return c.json(await answer(c, body.month), 200);
  });

  app.openapi(deleteRoute, async (c) => {
    const { id, month } = c.req.valid("param");
    const deleted = await deletePayout(c.env.DB, { ...change(c), channelId: id, month });
    if (deleted === "not_found") return refuse(c, "not_found");
    return c.json(await answer(c, month), 200);
  });
}
