// Discount codes, behind Access (Settings · Discount codes, and a client's Visits tab;
// docs/decisions/0108-discount-codes.md):
//
//   GET  /api/discount-codes                        the latest codes made, with their uses and what they gave
//   POST /api/discount-codes                        one code, typed or generated, or a batch of single-use codes
//   POST /api/discount-codes/{id}/off               switched off: no booking takes it from then on
//   POST /api/visits/{id}/discount-code             a code entered on a client's visit, before it is paid or invoiced
//   POST /api/visits/{id}/discount-code/remove      the code taken off the visit again
//
// Each change is audited in the batch that makes it, with IDs and codes only (ADR 0031). A code ops enter that does
// not apply is answered as it is to the client, code_not_applicable, save one switched off, code_off, since ops
// switch codes off themselves. The code's own row in the list says why of the rest.

import { createRoute, z } from "@hono/zod-openapi";
import { PRICE_BOUNDS } from "../config/ops-settings.ts";
import { codeOnVisit, enterOnVisit, removeFromVisit } from "../domain/discount-code-uses.ts";
import { BATCH_MOST, listCodes, LISTED_MOST, makeCodes, switchOff, type NewCodes } from "../domain/discount-codes.ts";
import { actorOf } from "../http/audit.ts";
import type { App } from "../http/context.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";
import { withinRouteReach } from "../http/staff-access.ts";
import { indiaDate } from "../lib/india-time.ts";
import { CODE_LENGTH, COVERABLE, DISCOUNT_KINDS, isCodeText, termsRefusal } from "../policy/discount-codes.ts";

const GivenBySchema = z.enum(["client", "technician", "ops"]);

const CodeSchema = z
  .object({
    id: z.uuid(),
    code: z.string(),
    kind: z.enum(DISCOUNT_KINDS),
    value: z.number().int().openapi({ description: "Per cent for a percentage; paise before GST for an amount." }),
    cap: z
      .union([z.number().int(), z.null()])
      .openapi({ description: "The most a percentage takes off, in paise before GST; null for none." }),
    covers: z.array(z.enum(COVERABLE)).openapi({ description: "The kinds of visit it takes money off." }),
    expires_on: z
      .union([z.iso.date(), z.null()])
      .openapi({ description: "The last day in India it may be entered; null for no end." }),
    max_uses: z
      .union([z.number().int(), z.null()])
      .openapi({ description: "How many bookings it may be on; null for no limit." }),
    once_per_client: z.boolean(),
    batch_id: z
      .union([z.uuid(), z.null()])
      .openapi({ description: "The codes generated with it in one press; null for one made alone." }),
    created_by: z.string(),
    created_at: z.iso.datetime(),
    switched_off: z
      .union([z.object({ by: z.string(), at: z.iso.datetime() }).strict(), z.null()])
      .openapi({ description: "Who switched it off and when; null while it is on." }),
    uses: z.number().int().openapi({ description: "The bookings it stands on." }),
    given: z.number().int().openapi({
      description: "What it has taken off those bookings, in paise before GST, as far as their prices are known.",
    }),
  })
  .strict()
  .openapi("DiscountCode");

const CodesSchema = z
  .object({
    today: z.iso.date().openapi({ description: "India's date, the first a code may expire on." }),
    batch_most: z.number().int().openapi({ description: "The most codes one press generates." }),
    listed_most: z.number().int().openapi({ description: "The most codes the list shows, the latest made first." }),
    codes: z.array(CodeSchema),
  })
  .strict()
  .openapi("DiscountCodes");

const NewCodesSchema = z
  .object({
    code: z
      .string()
      .trim()
      .max(40)
      .optional()
      .openapi({
        description:
          `A code ops typed, ${String(CODE_LENGTH.min)} to ${String(CODE_LENGTH.max)} letters and digits; left out, ` +
          "each code is generated, of letters and digits that cannot be read as each other.",
      }),
    count: z
      .number()
      .int()
      .min(1)
      .max(BATCH_MOST)
      .optional()
      .openapi({ description: "How many to generate, one if left out; more than one is a batch of single-use codes." }),
    kind: z.enum(DISCOUNT_KINDS),
    value: z.number().int().min(1).max(PRICE_BOUNDS.maxPaise).openapi({
      description: "Per cent, 1 to 100, for a percentage; paise in whole rupees, before GST, for an amount.",
    }),
    cap: z
      .union([z.number().int().min(1).max(PRICE_BOUNDS.maxPaise), z.null()])
      .optional()
      .openapi({ description: "A percentage's most, in paise in whole rupees, before GST; none if left out." }),
    covers: z.array(z.enum(COVERABLE)).min(1).max(COVERABLE.length),
    expires_on: z
      .union([z.iso.date(), z.null()])
      .optional()
      .openapi({ description: "The last day in India it may be entered, today or later; no end if left out." }),
    max_uses: z
      .union([z.number().int().min(1).max(1_000_000), z.null()])
      .optional()
      .openapi({ description: "How many bookings it may be on; no limit if left out. A batch's codes are 1 each." }),
    once_per_client: z.boolean(),
  })
  .strict()
  .openapi("DiscountCodesNew");

type NewCodesBody = z.infer<typeof NewCodesSchema>;

const MadeSchema = z
  .object({ codes: z.array(z.string()).openapi({ description: "The codes made, in capitals." }) })
  .strict()
  .openapi("DiscountCodesMade");

const VisitCodeSchema = z
  .object({
    code: z.string(),
    amount_off: z
      .union([z.number().int(), z.null()])
      .openapi({ description: "In paise before GST; null until the visit's price is known, as a one visit's is." }),
    given_by: GivenBySchema,
  })
  .strict()
  .openapi("VisitDiscountCode");

const listRoute = createRoute({
  method: "get",
  path: "/api/discount-codes",
  summary: "The latest discount codes made, each with its uses and what it has taken off",
  request: {
    query: z.object({
      code: z
        .string()
        .trim()
        .max(40)
        .optional()
        .openapi({ description: "The codes that begin with this text, however old." }),
    }),
  },
  responses: { 200: { description: "The codes", ...json(CodesSchema) }, 403: errorResponse("access_required") },
});

const makeRoute = createRoute({
  method: "post",
  path: "/api/discount-codes",
  summary: "Make a code, typed or generated, or a batch of single-use codes",
  request: { body: { required: true, ...json(NewCodesSchema) } },
  responses: {
    201: { description: "Made", ...json(MadeSchema) },
    400: errorResponse(
      "invalid_request: fields names code when it is not one a code can be, count for a typed code made more than " +
        "once, value for a percentage over 100 or an amount not in whole rupees, cap on an amount or not in whole " +
        "rupees, covers named twice, expires_on before today, and " +
        "max_uses for a batch whose codes are not single-use",
    ),
    403: errorResponse("access_required"),
    409: errorResponse("code_exists: a code with that text exists already"),
  },
});

const offRoute = createRoute({
  method: "post",
  path: "/api/discount-codes/{id}/off",
  summary: "Switch a code off: no booking takes it from then on, and its uses stay as they are",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    204: { description: "Off, or off already" },
    403: errorResponse("access_required"),
    404: errorResponse("not_found"),
  },
});

const visitId = z.object({ id: z.uuid().openapi({ description: "The client's visit." }) });

const enterRoute = createRoute({
  method: "post",
  path: "/api/visits/{id}/discount-code",
  summary: "Enter a discount code on a client's visit, before it is paid for, its link is made, or it is invoiced",
  request: {
    params: visitId,
    body: { required: true, ...json(z.object({ code: z.string().trim().min(1).max(40) }).strict()) },
  },
  responses: {
    200: { description: "The code on the visit", ...json(VisitCodeSchema) },
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such visit in the caller's cities"),
    409: errorResponse(
      "already_discounted: the visit carries a code; price_settled: it is paid for, its payment link is made, it is " +
        "invoiced, or it is cancelled",
    ),
    422: errorResponse("code_not_applicable: the code does not apply to this visit; code_off: it is switched off"),
  },
});

const removeRoute = createRoute({
  method: "post",
  path: "/api/visits/{id}/discount-code/remove",
  summary: "Take the code off a client's visit, before it is paid for, its link is made, or it is invoiced",
  request: { params: visitId },
  responses: {
    204: { description: "Taken off; its use stays on record, marked removed" },
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such visit in the caller's cities, or it carries no code"),
    409: errorResponse("price_settled: it is paid for, its payment link is made, or it is invoiced"),
  },
});

/** The field a request to make codes is refused for, beyond what its schema checks; null when it may be made. */
function makeRefusal(body: NewCodesBody, today: string): string | null {
  const count = body.count ?? 1;
  if (body.code !== undefined && !isCodeText(body.code)) return "code";
  if (body.code !== undefined && count > 1) return "count";
  const terms = termsRefusal({ kind: body.kind, value: body.value, cap: body.cap ?? null });
  if (terms !== null) return terms;
  if (new Set(body.covers).size !== body.covers.length) return "covers";
  if ((body.expires_on ?? null) !== null && (body.expires_on ?? "") < today) return "expires_on";
  // A batch is of single-use codes (RULES[3]: "total uses (one, many or unlimited)", one each for a batch's).
  if (count > 1 && body.max_uses !== 1) return "max_uses";
  return null;
}

const newCodesOf = (body: NewCodesBody): NewCodes => ({
  code: body.code ?? null,
  count: body.count ?? 1,
  kind: body.kind,
  value: body.value,
  cap: body.cap ?? null,
  covers: body.covers,
  expiresOn: body.expires_on ?? null,
  maxUses: body.max_uses ?? null,
  oncePerClient: body.once_per_client,
});

export function registerOpsDiscountCodes(app: App): void {
  app.openapi(listRoute, async (c) => {
    const now = c.var.deps.now();
    const codes = await listCodes(c.env.DB, now, c.req.valid("query").code ?? null);
    return c.json({ today: indiaDate(now), batch_most: BATCH_MOST, listed_most: LISTED_MOST, codes: [...codes] }, 200);
  });

  app.openapi(makeRoute, async (c) => {
    const { requestId, deps } = c.var;
    const now = deps.now();
    const body = c.req.valid("json");
    const refused = makeRefusal(body, indiaDate(now));
    if (refused !== null) return c.json(errorBody("invalid_request", requestId, [refused]), 400);
    const made = await makeCodes(c.env.DB, newCodesOf(body), { actor: actorOf(c), requestId, now });
    if (made.kind === "code_exists") return c.json(errorBody("code_exists", requestId), 409);
    return c.json({ codes: [...made.codes] }, 201);
  });

  app.openapi(offRoute, async (c) => {
    const { requestId, deps } = c.var;
    const change = { actor: actorOf(c), requestId, now: deps.now() };
    const switched = await switchOff(c.env.DB, c.req.valid("param").id, change);
    if (switched === "not_found") return c.json(errorBody("not_found", requestId), 404);
    return c.body(null, 204);
  });

  app.openapi(enterRoute, async (c) => {
    const { requestId, log, deps } = c.var;
    const { id } = c.req.valid("param");
    if (!(await withinRouteReach(c, "visit", id))) return c.json(errorBody("not_found", requestId), 404);
    const by = { kind: "ops", actor: actorOf(c) } as const;
    const entered = await enterOnVisit(
      c.env.DB,
      { visitId: id, text: c.req.valid("json").code, by, requestId },
      deps.now(),
    );
    if (entered.kind === "not_applicable") {
      log.info("discount_code_refused", { appointment_id: id, reason: entered.reason });
      const refused = entered.reason === "switched_off" ? "code_off" : "code_not_applicable";
      return c.json(errorBody(refused, requestId), 422);
    }
    if (entered.kind === "not_found") return c.json(errorBody("not_found", requestId), 404);
    if (entered.kind === "already_discounted") return c.json(errorBody("already_discounted", requestId), 409);
    if (entered.kind !== "applied") return c.json(errorBody("price_settled", requestId), 409);
    const onVisit = await codeOnVisit(c.env.DB, id);
    if (onVisit === null) return c.json(errorBody("not_found", requestId), 404);
    return c.json({ code: onVisit.code, amount_off: onVisit.amountOff, given_by: onVisit.givenBy }, 200);
  });

  app.openapi(removeRoute, async (c) => {
    const { requestId, deps } = c.var;
    const { id } = c.req.valid("param");
    if (!(await withinRouteReach(c, "visit", id))) return c.json(errorBody("not_found", requestId), 404);
    const by = { kind: "ops", actor: actorOf(c) } as const;
    const removed = await removeFromVisit(c.env.DB, { visitId: id, by, requestId }, deps.now());
    if (removed === "price_settled") return c.json(errorBody("price_settled", requestId), 409);
    if (removed !== "removed") return c.json(errorBody("not_found", requestId), 404);
    return c.body(null, 204);
  });
}
