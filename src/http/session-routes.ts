// The session a client's or a technician's route needs, declared on the route itself (createRoute's middleware), so
// the guard stands with the route it guards, whatever order the modules are registered in.
// test/worker/platform/every-route-guarded.test.ts asks every route of both surfaces without a session.

import { createRoute, type RouteConfig } from "@hono/zod-openapi";
import { requireClientSession } from "./client-session.ts";
import { errorResponse } from "./errors.ts";
import { requireSelfServe } from "./self-serve.ts";
import { requireTechnicianSession } from "./technician-session.ts";

/** A route a signed-in client calls. */
export const clientRoute = <R extends RouteConfig>(route: R) =>
  createRoute({ ...route, middleware: [requireClientSession] });

/** A route that books, which a signed-in client calls while self-serve booking is on (ADR 0045). */
export const selfServeRoute = <R extends RouteConfig>(route: R) =>
  createRoute({ ...route, middleware: [requireClientSession, requireSelfServe] });

/** A route a signed-in technician calls. */
export const techRoute = <R extends RouteConfig>(route: R) =>
  createRoute({ ...route, middleware: [requireTechnicianSession] });
export const signedIn = { 401: errorResponse("session_required") };
