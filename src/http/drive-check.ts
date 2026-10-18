// Google, to check the drives either side of a start before it is held (src/domain/booking/drive-check.ts): null
// where the routes provider is off, and booking holds on the free estimate alone.

import type { Context } from "hono";
import type { AppEnv } from "./context.ts";
import type { DriveCheck } from "../domain/booking/drive-check.ts";

export function driveCheckOf(c: Context<AppEnv>): DriveCheck | null {
  const { routes, alert } = c.var.deps;
  return routes === null ? null : { routes, alert, settings: c.var.config.settings };
}
