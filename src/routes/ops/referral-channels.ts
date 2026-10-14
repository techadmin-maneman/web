// Partners who send us clients on their own code, behind Access (Growth; docs/decisions/0123-partner-referral-channels.md).

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { actorOf } from "../../http/audit.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { addChannel, changeChannel, listChannels, pauseChannel } from "../../domain/referrals/channels.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { MAX_REWARD_VISITS } from "../../policy/referral-reward.ts";

/** A partner's name: a letter or a digit first, then letters, digits, spaces and . , ' ( ) & / -. */
const PARTNER_NAME = /^[\p{L}\p{N}][\p{L}\p{N} .,'()&/-]{0,59}$/u;

/** The longest a friend's visits may last, and the shortest, as the clients' reward is held to. */
const VALID_DAYS = { min: 30, max: 1095 };

/** The most one fitted friend may earn a partner, in paise: a guard against a figure typed a hundred times too big. */
const MAX_COMMISSION = 5_000_000;

const ChannelSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    code: z.string().openapi({ description: "The partner's code, as its link and QR carry it: /r/<code>." }),
    friend_visits: z.number().int(),
    valid_days: z.number().int(),
    commission: z.number().int().openapi({ description: "Paise for each friend fitted; 0 for none." }),
    paused_at: z.union([z.iso.datetime(), z.null()]),
    opens: z.number().int().openapi({ description: "The invite page opened, once a day for each address." }),
    referred: z.number().int().openapi({ description: "People who came through the code." }),
    fitted: z
      .number()
      .int()
      .openapi({ description: "Of those, fitted: the friend's visits given, the commission earned." }),
    earned: z.number().int().openapi({ description: "Paise earned, at the commission in force when each was fitted." }),
    owed: z.number().int().openapi({ description: "Of that, paise not yet paid (GET /api/partner-statements)." }),
    discount_code: z.union([z.string(), z.null()]).openapi({
      description: "The partner's discount code, off the friend's first paid visit by itself; null for none.",
    }),
  })
  .strict();

const ListSchema = z
  .object({
    channels: z.array(ChannelSchema),
    limits: z
      .object({
        max_visits: z.number().int(),
        min_days: z.number().int(),
        max_days: z.number().int(),
        max_commission: z.number().int(),
      })
      .strict(),
  })
  .strict()
  .openapi("ReferralChannels");

const TermsSchema = z
  .object({
    name: z.string().trim().regex(PARTNER_NAME),
    friend_visits: z.number().int().min(0).max(MAX_REWARD_VISITS),
    valid_days: z.number().int().min(VALID_DAYS.min).max(VALID_DAYS.max),
    commission: z.number().int().min(0).max(MAX_COMMISSION),
    discount_code: z.union([z.string().trim().min(1).max(40), z.null()]).openapi({
      description: "One of Finance's codes, switched on, any case; null for none.",
    }),
  })
  .strict();

const ok = { description: "The partners as they now stand", ...json(ListSchema) };
const Id = z.object({ id: z.uuid() });
const invalid = errorResponse(
  "invalid_request: fields names name, friend_visits, valid_days, commission or discount_code (none switched on)",
);

const listRoute = opsRoute({
  method: "get",
  path: "/api/referral-channels",
  summary: "Every partner, with what has come through each",
  responses: { 200: ok },
});

const addRoute = opsRoute({
  method: "post",
  path: "/api/referral-channels",
  summary: "Add a partner: its code is made for it",
  request: { body: { required: true, ...json(TermsSchema.openapi("ReferralChannelAdd")) } },
  responses: {
    200: ok,
    400: invalid,
    409: errorResponse("taken: a partner has that name"),
  },
});

const changeRoute = opsRoute({
  method: "patch",
  path: "/api/referral-channels/{id}",
  summary: "Change a partner's name or terms; a friend fitted from now on earns the new terms",
  request: { params: Id, body: { required: true, ...json(TermsSchema.openapi("ReferralChannelChange")) } },
  responses: {
    200: ok,
    400: invalid,
    404: errorResponse("not_found"),
    409: errorResponse("taken: another partner has that name"),
  },
});

const pauseRoute = opsRoute({
  method: "post",
  path: "/api/referral-channels/{id}/pause",
  summary: "Pause a partner, so nobody new comes through its code, or take the pause off",
  request: {
    params: Id,
    body: {
      required: true,
      ...json(z.object({ paused: z.boolean() }).strict().openapi("ReferralChannelPause")),
    },
  },
  responses: { 200: ok, 404: errorResponse("not_found") },
});

export function registerOpsReferralChannels(app: App): void {
  const list = async (c: Context<AppEnv>) => ({
    channels: await listChannels(c.env.DB),
    limits: {
      max_visits: MAX_REWARD_VISITS,
      min_days: VALID_DAYS.min,
      max_days: VALID_DAYS.max,
      max_commission: MAX_COMMISSION,
    },
  });
  const change = (c: Context<AppEnv>) => ({ actor: actorOf(c), requestId: c.var.requestId, now: c.var.deps.now() });
  const termsOf = (body: z.infer<typeof TermsSchema>) => ({
    name: body.name,
    friendVisits: body.friend_visits,
    validDays: body.valid_days,
    commission: body.commission,
    discountCode: body.discount_code,
  });

  app.openapi(listRoute, async (c) => c.json(await list(c), 200));

  app.openapi(addRoute, async (c) => {
    const added = await addChannel(c.env.DB, { ...change(c), ...termsOf(c.req.valid("json")) });
    if (added.outcome === "taken") return refuse(c, "taken");
    if (added.outcome === "no_code") return refuse(c, "invalid_request", ["discount_code"]);
    return c.json(await list(c), 200);
  });

  app.openapi(changeRoute, async (c) => {
    const changed = await changeChannel(c.env.DB, {
      ...change(c),
      ...termsOf(c.req.valid("json")),
      id: c.req.valid("param").id,
    });
    if (changed === "not_found") return refuse(c, "not_found");
    if (changed === "taken") return refuse(c, "taken");
    if (changed === "no_code") return refuse(c, "invalid_request", ["discount_code"]);
    return c.json(await list(c), 200);
  });

  app.openapi(pauseRoute, async (c) => {
    const set = await pauseChannel(c.env.DB, {
      ...change(c),
      id: c.req.valid("param").id,
      paused: c.req.valid("json").paused,
    });
    if (set === "not_found") return refuse(c, "not_found");
    return c.json(await list(c), 200);
  });
}
