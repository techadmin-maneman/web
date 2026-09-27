// Booking, moving and cancelling in the app wait on SELF_SERVE_BOOKING (docs/decisions/0045-self-serve-booking.md).
// Off, each of those routes answers 409 ops_assisted, and the app opens WhatsApp to ops instead.

import { createMiddleware } from "hono/factory";
import type { AppEnv } from "./context.ts";
import { errorBody } from "./errors.ts";

export const requireSelfServe = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.config.settings.selfServeBooking) return c.json(errorBody("ops_assisted", c.var.requestId), 409);
  return next();
});
