// The business inputs in force, for a route (docs/decisions/0061-ops-editable-inputs.md).
//
// Every route reads them the same way: through the isolate's cache, and with
// the same line in the log when the store cannot be read at all. It falls back
// to the committed defaults rather than refusing, because a number nobody has
// changed is still the right number.

import type { Context } from "hono";
import type { AppEnv } from "./context.ts";
import type { OpsInputs } from "../domain/ops-settings.ts";

export function opsInputs(c: Context<AppEnv>): Promise<OpsInputs> {
  return c.var.readOpsInputs(c.env.DB, c.var.deps.now(), (error: unknown) => {
    c.var.log.error("ops_settings_unreadable", { error });
  });
}
