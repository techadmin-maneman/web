// A number change as the client's profile shows it (src/routes/client/profile.ts, number-change.ts).

import { z } from "@hono/zod-openapi";
import type { NumberChange } from "../../domain/clients/number-change.ts";
import { maskedMobile } from "../../domain/clients/profile.ts";

export const NumberChangeSchema = z
  .object({
    request_id: z.uuid(),
    state: z.enum(["verifying", "awaiting_ops"]),
    new_mobile: z.string().openapi({ description: "Masked, as the design shows it: +91 98xxx x4417." }),
    old_verified: z.boolean(),
    new_verified: z.boolean(),
  })
  .strict()
  .openapi("NumberChange");
export function numberChangeBody(change: NumberChange) {
  return {
    request_id: change.id,
    state: change.state === "awaiting_ops" ? ("awaiting_ops" as const) : ("verifying" as const),
    new_mobile: maskedMobile(change.newMobileE164),
    old_verified: change.oldVerified,
    new_verified: change.newVerified,
  };
}
