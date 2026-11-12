// A fit's sign-off as the technician's card, the client's visit and the console read it, and the answer the client
// gives (docs/decisions/0254-client-signs-off-the-fit.md).

import { z } from "@hono/zod-openapi";
import {
  FLAG_MAX_CHARS,
  SIGN_OFF_CHECKS,
  SIGN_OFF_STATES,
  SIGNED_ON,
  type SignOffCheck,
} from "../../policy/sign-off.ts";

const ChecksSchema = z
  .object(
    Object.fromEntries(SIGN_OFF_CHECKS.map((check) => [check, z.boolean()])) as Record<SignOffCheck, z.ZodBoolean>,
  )
  .strict()
  .openapi("SignOffChecks", {
    description: "The hairline, the colour and blend, and that it is secure and comfortable: each ticked or not.",
  });

export const SignOffSchema = z
  .object({
    state: z.enum(SIGN_OFF_STATES).openapi({
      description:
        "asked: waiting for the client; signed: happy with the fit; flagged: something isn't right, which the " +
        "technician puts right and asks again; declined: closed without it, with why.",
    }),
    checks: z.union([ChecksSchema, z.null()]).openapi({ description: "As the client last answered; null till then." }),
    flag_text: z.union([z.string(), z.null()]).openapi({ description: "What isn't right, in the client's words." }),
    declined_reason: z.union([z.string(), z.null()]).openapi({ description: "Why the client did not sign." }),
    asked_at: z.iso.datetime(),
    asks: z.number().int().openapi({ description: "How many times it was asked: again after each flag." }),
    signed_at: z.union([z.iso.datetime(), z.null()]),
    signed_on: z.union([z.enum(SIGNED_ON), z.null()]),
    guarantee_days: z.union([z.number().int(), z.null()]).openapi({
      description: "The fit guarantee's days in force when it was signed or declined (ADR 0256); null before then.",
    }),
  })
  .strict()
  .openapi("SignOff");

export const SignOffAnswerSchema = z
  .discriminatedUnion("result", [
    z.object({ result: z.literal("signed"), checks: ChecksSchema }).strict(),
    z
      .object({
        result: z.literal("flagged"),
        checks: ChecksSchema,
        flag_text: z.string().trim().min(1).max(FLAG_MAX_CHARS),
      })
      .strict(),
  ])
  .openapi("SignOffAnswer", {
    description: "Happy with the fit, every check ticked; or something isn't right, in the client's words.",
  });
