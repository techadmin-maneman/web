import { OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { routePath } from "hono/route";
import type { Surface } from "./config/environments.ts";
import { productionDependencies, type Dependencies, type DependencyFactory } from "./dependencies.ts";
import { auditCall } from "./domain/audit.ts";
import { createCachedIdentityCheck, type IdentityCheck, type StaticConfig } from "./guard.ts";
import { createCachedOpsInputs, type ReadOpsInputs } from "./domain/ops-settings.ts";
import type { Session } from "./domain/sessions.ts";
import { requireAccess, type AccessIdentity } from "./http/access.ts";
import { ErrorResponseSchema, errorBody } from "./http/errors.ts";
import { requireSameOrigin } from "./http/origin.ts";
import type { TechnicianSession } from "./http/technician-session.ts";
import { createLogger, type Logger } from "./log.ts";
import { registerCities } from "./routes/cities.ts";
import { registerClientAuth } from "./routes/client-auth.ts";
import { registerClientMe } from "./routes/client-me.ts";
import { registerClientProfile } from "./routes/client-profile.ts";
import { registerClientBooking } from "./routes/client-booking.ts";
import { registerClientChanges } from "./routes/client-changes.ts";
import { registerClientData } from "./routes/client-data.ts";
import { registerClientRefer } from "./routes/client-refer.ts";
import { registerOpsClients } from "./routes/ops-clients.ts";
import { registerOpsDispatch } from "./routes/ops-dispatch.ts";
import { registerOpsField } from "./routes/ops-field.ts";
import { registerOpsGrievances } from "./routes/ops-grievances.ts";
import { registerOpsPayments } from "./routes/ops-payments.ts";
import { registerOpsReferrals } from "./routes/ops-referrals.ts";
import { registerOpsTasks } from "./routes/ops-tasks.ts";
import { registerOpsTechnicians } from "./routes/ops-technicians.ts";
import { registerOpsSettings } from "./routes/ops-settings.ts";
import { registerOpsWaitlist } from "./routes/ops-waitlist.ts";
import { registerConsultations } from "./routes/consultations.ts";
import { registerReferralLanding } from "./routes/referral-landing.ts";
import { registerClientPayments } from "./routes/client-payments.ts";
import { registerClientVisits } from "./routes/client-visits.ts";
import { registerErasure } from "./routes/erasure.ts";
import { registerEvolutionHook } from "./routes/evolution-hook.ts";
import { registerFsmHook } from "./routes/fsm-hook.ts";
import { registerRazorpayHook } from "./routes/razorpay-hook.ts";
import { registerHealth } from "./routes/health.ts";
import { registerLead } from "./routes/lead.ts";
import { registerOpsProfile } from "./routes/ops-profile.ts";
import { registerTechAuth } from "./routes/tech-auth.ts";
import { registerTechJobs } from "./routes/tech-jobs.ts";
import { registerTechPieces } from "./routes/tech-pieces.ts";
import { registerTryonClaim } from "./routes/tryon-claim.ts";
import { registerTryonGenerate } from "./routes/tryon-generate.ts";
import { registerTryonResult } from "./routes/tryon-result.ts";
import { registerTryonUpload } from "./routes/tryon-upload.ts";

/** What every handler can read from `c.env` and `c.var`. */
export type AppEnv = {
  Bindings: Env;
  Variables: {
    requestId: string;
    log: Logger;
    config: StaticConfig;
    deps: Dependencies;
    checkIdentity: IdentityCheck;
    /** The business inputs ops set, cached per isolate (ADR 0060). */
    readOpsInputs: ReadOpsInputs;
    surface: Surface;
    /** Set on the ops surface by requireAccess. */
    accessIdentity?: AccessIdentity;
    /** Set on the client surface's session routes by requireClientSession. */
    clientSession?: Session;
    /** Set on the technician surface's session routes by requireTechnicianSession. */
    technicianSession?: TechnicianSession;
  };
};

export type App = OpenAPIHono<AppEnv>;

export const REQUEST_ID_HEADER = "X-Request-Id";

/** Routes that report on the database themselves instead of being blocked by it. */
const IDENTITY_EXEMPT_ROUTES = new Set(["/api/health"]);

/**
 * Each surface's routes (docs/decisions/0026-hosts-and-surfaces.md). A route
 * answers only on its own surface's host; anywhere else it is a 404.
 */
const SURFACE_ROUTES: Readonly<Record<Surface, readonly ((app: App) => void)[]>> = {
  public: [
    registerHealth,
    registerCities,
    registerLead,
    registerConsultations,
    registerReferralLanding,
    registerTryonUpload,
    registerTryonGenerate,
    registerTryonClaim,
    registerTryonResult,
    registerErasure,
    // Webhooks sit on the public host (ADR 0026).
    registerEvolutionHook,
    registerFsmHook,
    registerRazorpayHook,
  ],
  client: [
    registerHealth,
    registerClientAuth,
    registerClientMe,
    registerClientProfile,
    registerClientVisits,
    registerClientPayments,
    registerClientBooking,
    registerClientChanges,
    registerClientRefer,
    registerClientData,
  ],
  ops: [
    registerHealth,
    registerOpsClients,
    registerOpsProfile,
    registerOpsReferrals,
    registerOpsGrievances,
    registerOpsWaitlist,
    registerOpsDispatch,
    registerOpsField,
    registerOpsTasks,
    registerOpsPayments,
    registerOpsTechnicians,
    registerOpsSettings,
  ],
  tech: [registerHealth, registerTechAuth, registerTechJobs, registerTechPieces],
};

export function createApp(
  config: StaticConfig,
  makeDependencies?: DependencyFactory,
  surface: Surface = "public",
): App {
  const app = new OpenAPIHono<AppEnv>({
    // A request that fails its zod schema: name the fields, never echo their values.
    defaultHook: (result, c) => {
      if (result.success) return undefined;
      const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".") || "body"))];
      return c.json(errorBody("invalid_request", c.var.requestId, fields), 400);
    },
  });

  const dependencies = makeDependencies ?? productionDependencies(config);
  app.use("*", requestContext(config, dependencies, createCachedIdentityCheck(), createCachedOpsInputs(), surface));
  app.use("/api/*", requireOwnDatabase);
  // The ops console is staff only: every call needs a valid Access token, and is audited (ADR 0031).
  if (surface === "ops") app.use("/api/*", requireAccess, auditCall);
  // The public site's writes are guarded by Turnstile; the Phase 2 surfaces carry session cookies.
  if (surface !== "public") app.use("/api/*", requireSameOrigin);

  app.openAPIRegistry.register("ErrorResponse", ErrorResponseSchema);
  for (const register of SURFACE_ROUTES[surface]) register(app);

  app.notFound((c) => c.json(errorBody("not_found", c.var.requestId), 404));
  app.onError((error, c) => {
    // Hono raises a 400 for a body that is not valid JSON.
    if (error instanceof HTTPException && error.status === 400) {
      return c.json(errorBody("invalid_request", c.var.requestId, ["body"]), 400);
    }
    c.var.log.error("unhandled_error", { error });
    return c.json(errorBody("internal_error", c.var.requestId), 500);
  });

  return app;
}

/** Gives each request an ID, a logger and its dependencies; sets common headers; logs the request. */
function requestContext(
  config: StaticConfig,
  makeDependencies: DependencyFactory,
  checkIdentity: IdentityCheck,
  readOpsInputs: ReadOpsInputs,
  surface: Surface,
): MiddlewareHandler<AppEnv> {
  const baseLog = createLogger({ worker: "mm-api", environment: config.environment, surface });

  return createMiddleware<AppEnv>(async (c, next) => {
    const started = Date.now();
    const requestId = crypto.randomUUID();
    const log = baseLog.child({ request_id: requestId });
    c.set("requestId", requestId);
    c.set("log", log);
    c.set("config", config);
    c.set("deps", makeDependencies(c.env, log));
    c.set("checkIdentity", checkIdentity);
    c.set("readOpsInputs", readOpsInputs);
    c.set("surface", surface);

    await next();

    c.header(REQUEST_ID_HEADER, requestId);
    c.header("X-Content-Type-Options", "nosniff");
    if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
    if (config.environment !== "production") c.header("X-Robots-Tag", "noindex, nofollow");

    log.info("request", {
      method: c.req.method,
      route: routePath(c, -1), // the pattern, e.g. /api/result/:token; never the path, which can hold a token
      status: c.res.status,
      duration_ms: Date.now() - started,
    });
  });
}

/** Answers 503 unless this Worker's database is marked as its own environment's. */
const requireOwnDatabase = createMiddleware<AppEnv>(async (c, next) => {
  if (IDENTITY_EXEMPT_ROUTES.has(c.req.path)) return next();

  const identity = await c.var.checkIdentity(c.env.DB, c.var.config.environment);
  if (identity.state === "ok") return next();

  if (identity.state === "unreachable") {
    c.var.log.error("database_identity_failed", { state: identity.state, error: identity.error });
    return c.json(errorBody("unavailable", c.var.requestId), 503);
  }
  c.var.log.error("database_identity_failed", { state: identity.state });
  return c.json(errorBody("environment_mismatch", c.var.requestId), 503);
});
