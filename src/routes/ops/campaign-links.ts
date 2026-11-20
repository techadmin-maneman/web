// Growth's campaign links, behind Access (Growth; docs/decisions/0288-attribution-and-conversions.md, docs/tracking.md):
// a society activation or an offer link, made with its tags and code and any discount code for the first fit, listed
// with what it brought, and retired.

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
  addCampaignLink,
  campaignLinks,
  linkableCodes,
  retireCampaignLink,
  shortLinkOf,
  type CampaignLink,
} from "../../domain/attribution/campaign-links.ts";
import { actorOf } from "../../http/audit.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { CAMPAIGN_MAX, OFFER_MEDIUMS, OFFER_SOURCES, TAG_PATTERN } from "../../policy/campaign-links.ts";

const PaiseSchema = z.number().int().min(100).max(10_000_000_000).openapi({ description: "Paise, before GST." });

const LinkSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(["society", "offer"]),
    slug: z.string(),
    code: z.string(),
    name: z.string(),
    utm_source: z.string(),
    utm_medium: z.string(),
    utm_campaign: z.string(),
    city: z.union([z.string(), z.null()]),
    pincode: z.union([z.string(), z.null()]),
    held_date: z.union([z.iso.date(), z.null()]),
    discount_code: z.union([z.string(), z.null()]),
    short_link: z.string().openapi({ description: "The link to print or share: /s/<slug> or /o/<slug> on our site." }),
    created_by: z.string(),
    created_at: z.iso.datetime(),
    retired_at: z.union([z.iso.datetime(), z.null()]),
    spent: z.number().int().openapi({ description: "Spend on it, in paise before GST." }),
    touches: z.number().int(),
    people: z.number().int(),
  })
  .strict()
  .openapi("CampaignLink");

const listRoute = opsRoute({
  method: "get",
  path: "/api/campaign-links",
  summary: "Every campaign link, the newest first, and the discount codes and tags a new one may take",
  responses: {
    200: {
      description: "The links",
      ...json(
        z
          .object({
            links: z.array(LinkSchema),
            discount_codes: z.array(
              z
                .object({
                  id: z.uuid(),
                  code: z.string(),
                  kind: z.enum(["percent", "amount"]),
                  value: z.number().int(),
                  expires_on: z.union([z.iso.date(), z.null()]),
                })
                .strict(),
            ),
            sources: z.array(z.enum(OFFER_SOURCES)),
            mediums: z.array(z.enum(OFFER_MEDIUMS)),
            cities: z.array(z.string()).openapi({ description: "The cities an offer link may be aimed at." }),
          })
          .strict()
          .openapi("CampaignLinks"),
      ),
    },
  },
});

const NameSchema = z.string().trim().min(1).max(80);

const NewLinkSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("society"),
        name: NameSchema.openapi({ description: "The society's name." }),
        pincode: z.string().regex(/^\d{6}$/),
        held_date: z.iso.date(),
        costs: z
          .array(
            z
              .object({
                line: z.enum(["stall", "staff", "collateral", "other"]),
                amount: PaiseSchema,
                note: z.string().trim().min(1).max(200).optional(),
              })
              .strict(),
          )
          .max(10),
        discount_code_id: z.uuid().optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("offer"),
        name: NameSchema,
        utm_source: z.enum(OFFER_SOURCES),
        utm_medium: z.enum(OFFER_MEDIUMS),
        utm_campaign: z.string().max(CAMPAIGN_MAX).regex(TAG_PATTERN),
        city: z.string().trim().min(1).max(60).optional(),
        discount_code_id: z.uuid().optional(),
      })
      .strict(),
  ])
  .openapi("CampaignLinkNew");

const addRoute = opsRoute({
  method: "post",
  path: "/api/campaign-links",
  summary: "Make a society activation's link, with its costs as spend, or an offer's",
  request: { body: { required: true, ...json(NewLinkSchema) } },
  responses: {
    200: { description: "Made", ...json(LinkSchema) },
    400: errorResponse(
      "invalid_request: fields names pincode for one we cannot place, city for one we do not hold, or " +
        "discount_code_id for a code switched off or not for a first fit",
    ),
  },
});

const retireRoute = opsRoute({
  method: "post",
  path: "/api/campaign-links/{id}/retire",
  summary: "Retire a link: it sends visitors to /book with nothing, and keeps what it brought",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: { description: "Retired", ...json(z.object({ ok: z.literal(true) }).strict()) },
    404: errorResponse("not_found: no such link, or retired already"),
  },
});

const changeOf = (c: Context<AppEnv>) => ({ actor: actorOf(c), requestId: c.var.requestId, now: c.var.deps.now() });

const shown = (c: Context<AppEnv>, link: CampaignLink) => ({
  ...link,
  short_link: shortLinkOf(c.var.config.environment, link),
});

const REFUSED_FIELD = { no_city: "city", no_pincode: "pincode", no_discount_code: "discount_code_id" } as const;

export function registerOpsCampaignLinks(app: App): void {
  app.openapi(listRoute, async (c) => {
    const [links, codes, cities] = await Promise.all([
      campaignLinks(c.env.DB),
      linkableCodes(c.env.DB),
      c.env.DB.prepare("SELECT name FROM cities ORDER BY sort").all<{ name: string }>(),
    ]);
    return c.json(
      {
        links: links.map((link) => shown(c, link)),
        discount_codes: codes.map(
          (code) => ({ ...code, kind: code.kind === "amount" ? "amount" : "percent" }) as const,
        ),
        sources: [...OFFER_SOURCES],
        mediums: [...OFFER_MEDIUMS],
        cities: cities.results.map((city) => city.name),
      },
      200,
    );
  });

  app.openapi(addRoute, async (c) => {
    const body = c.req.valid("json");
    const discountCodeId = body.discount_code_id ?? null;
    const link =
      body.kind === "society"
        ? {
            kind: body.kind,
            name: body.name,
            pincode: body.pincode,
            heldDate: body.held_date,
            costs: body.costs.map((cost) => ({ line: cost.line, amount: cost.amount, note: cost.note ?? null })),
            discountCodeId,
          }
        : {
            kind: body.kind,
            name: body.name,
            utmSource: body.utm_source,
            utmMedium: body.utm_medium,
            utmCampaign: body.utm_campaign,
            city: body.city ?? null,
            discountCodeId,
          };
    const made = await addCampaignLink(c.env.DB, { ...changeOf(c), link });
    if (typeof made === "string") return refuse(c, "invalid_request", [REFUSED_FIELD[made]]);
    return c.json(shown(c, made), 200);
  });

  app.openapi(retireRoute, async (c) => {
    const retired = await retireCampaignLink(c.env.DB, { ...changeOf(c), id: c.req.valid("param").id });
    return retired ? c.json({ ok: true as const }, 200) : refuse(c, "not_found");
  });
}
