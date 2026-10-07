// The session a client's or a technician's route needs, declared on the route itself (createRoute's middleware), so
// the guard stands with the route it guards, whatever order the modules are registered in. Each call is then written to
// the audit log under the client or technician who made it (./audit.ts).
// test/worker/platform/every-route-guarded.test.ts asks every route of both surfaces without a session.

import { createRoute, type RouteConfig } from "@hono/zod-openapi";
import { auditSessionCall } from "./audit.ts";
import { requireClientSession } from "./client-session.ts";
import { errorResponse } from "./errors.ts";
import { requireSelfServe } from "./self-serve.ts";
import { requireTechnicianSession } from "./technician-session.ts";

/** A route a signed-in client calls. */
export const clientRoute = <R extends RouteConfig>(route: R) =>
  createRoute({ ...route, middleware: [requireClientSession, auditSessionCall] });

/** A route that books, which a signed-in client calls while self-serve booking is on (ADR 0045). */
export const selfServeRoute = <R extends RouteConfig>(route: R) =>
  createRoute({ ...route, middleware: [requireClientSession, auditSessionCall, requireSelfServe] });

/** A route a signed-in technician calls. */
export const techRoute = <R extends RouteConfig>(route: R) =>
  createRoute({ ...route, middleware: [requireTechnicianSession, auditSessionCall] });
export const signedIn = { 401: errorResponse("session_required") };
