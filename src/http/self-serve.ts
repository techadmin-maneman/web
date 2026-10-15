// Booking, moving and cancelling in the app wait on self-serve booking (docs/decisions/0045-self-serve-booking.md):
// every kind of visit with SELF_SERVE_BOOKING, the free consultation alone with SELF_SERVE_CONSULTATIONS. A route
// answers 409 ops_assisted for a kind the client may not book themselves, and the app opens WhatsApp to ops instead.

import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { VisitType } from "../config/visit-types.ts";
import { selfServeKinds } from "../policy/self-serve.ts";
import type { AppEnv } from "./context.ts";
import { refuse } from "./errors.ts";

export const requireSelfServe = createMiddleware<AppEnv>(async (c, next) => {
  if (selfServeKinds(c.var.config.settings).length === 0) return refuse(c, "ops_assisted");
  return next();
});

/** Whether the client books, moves and cancels this kind of visit themselves. */
export const servesItself = (c: Context<AppEnv>, kind: VisitType): boolean =>
  selfServeKinds(c.var.config.settings).includes(kind);
