// Whether a number typed into the site was proved with its WhatsApp code (src/policy/number-proof.ts), as the forms
// that act on it ask before they do.

import type { Context } from "hono";
import { mobileHashOf, numberProved } from "../domain/number-codes.ts";
import type { AppEnv } from "./context.ts";

/** Whether the code `codeId` proved this number, and still does. No code proves nothing. */
export async function provedNumber(c: Context<AppEnv>, codeId: string | null, mobileE164: string): Promise<boolean> {
  if (codeId === null) return false;
  const mobileHash = await mobileHashOf(c.var.config.settings.ipHashSalt, mobileE164);
  return numberProved(c.env.DB, { id: codeId, mobileHash, now: c.var.deps.now() });
}
