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

/**
 * What every console route may answer besides its own replies: Access's and the Staff list's refusals, which stand
 * before every route of the surface (src/app.ts). The error handler's 500 and the database check's 503 stand before
 * every route of every surface, and are left to the API's description of all of them (test/any-route.ts).
 */
const OPS_RESPONSES = {
  403: errorResponse(
    "access_required: no Access identity; not_permitted: the caller's grants do not reach this route, or it asks a " +
      "member of staff and the caller is a service token",
  ),
};

/** A console route: its own replies, and the refusals every console route can give. A route's own 403 says more. */
export const opsRoute = <R extends RouteConfig>(route: R) =>
  createRoute({ ...route, responses: { ...OPS_RESPONSES, ...route.responses } });
