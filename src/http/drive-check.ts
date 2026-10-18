// Google, to check the drives either side of a start before it is held (src/domain/booking/drive-check.ts): null
// where the routes provider is off, and booking holds on the free estimate alone.

import type { Context } from "hono";
import type { AppEnv } from "./context.ts";
import type { DriveCheck } from "../domain/booking/drive-check.ts";
import { ALERT_WORDS } from "../config/alert-words.ts";

const ROUTES_REFUSED = "routes_refused";

export function driveCheckOf(c: Context<AppEnv>): DriveCheck | null {
  const { routes, alert, alertOnce, resolveAlert } = c.var.deps;
  if (routes === null) return null;
  return {
    routes,
    alert,
    settings: c.var.config.settings,
    refused: async (detail) => {
      c.var.log.warn("drive_check_refused", { detail });
      await alertOnce({ key: ROUTES_REFUSED, message: ALERT_WORDS.routes_refused({ detail }) });
    },
    answered: () => resolveAlert(ROUTES_REFUSED),
  };
}
