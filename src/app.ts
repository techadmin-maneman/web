import { OpenAPIHono } from "@hono/zod-openapi";
import { isTransientD1Error } from "./lib/d1-errors.ts";
import type { Context, MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { routePath } from "hono/route";
import type { Surface } from "./config/environments.ts";
import { productionDependencies, type DependencyFactory } from "./dependencies.ts";
import { auditCall } from "./http/audit.ts";
import { createCachedIdentityCheck, type IdentityCheck, type StaticConfig } from "./guard.ts";
import { createCachedOpsInputs, type ReadOpsInputs } from "./domain/platform/ops-settings.ts";
import { requireAccess } from "./http/access.ts";
import { requireStaffAccess } from "./http/staff-access.ts";
import { REQUEST_ID_HEADER, type App, type AppEnv } from "./http/context.ts";
import { ErrorResponseSchema, refuse } from "./http/errors.ts";
import { requireSameOrigin } from "./http/origin.ts";
import { meterDatabase, serverTiming, usageFields } from "./lib/d1-meter.ts";
import { createLogger } from "./log.ts";
import type { ErrorTracker } from "./providers/error-tracking.ts";
import { registerClientAuth } from "./routes/client/auth.ts";
import { registerClientMe } from "./routes/client/me.ts";
import { registerClientDeletionRequest, registerClientProfile } from "./routes/client/profile.ts";
import { registerClientAddress } from "./routes/client/address.ts";
import { registerClientConsents } from "./routes/client/consents.ts";
import { registerClientNumberChange } from "./routes/client/number-change.ts";
import { registerClientSessions } from "./routes/client/sessions.ts";
import { registerClientAvailability } from "./routes/client/availability.ts";
import { registerClientBooking } from "./routes/client/booking.ts";
import { registerClientChanges } from "./routes/client/changes.ts";
import { registerClientNotes } from "./routes/client/notes.ts";
import { registerClientCustomOrders } from "./routes/client/custom-orders.ts";
import { registerClientData } from "./routes/client/data.ts";
import { registerClientDiscountCodes } from "./routes/client/discount-codes.ts";
import { registerTechDiscountCodes } from "./routes/tech/discount-codes.ts";
import { registerTechKit } from "./routes/tech/kit.ts";
import { registerTechMonth } from "./routes/tech/month.ts";
import { registerTechLeave } from "./routes/tech/leave.ts";
import { registerTechOptions } from "./routes/tech/options.ts";
import { registerClientDisputes } from "./routes/client/disputes.ts";
import { registerClientProblems } from "./routes/client/problems.ts";
import { registerClientMoveProposals } from "./routes/client/move-proposals.ts";
import { registerClientErrors } from "./routes/client-errors.ts";
import { registerClientRefer } from "./routes/client/refer.ts";
import { registerConsultations } from "./routes/public/consultations.ts";
import { registerBuildingSuggestions } from "./routes/public/building-suggestions.ts";
import { registerLead } from "./routes/public/lead.ts";
import { registerNumberCodes } from "./routes/public/number-codes.ts";
import { registerReferralLanding } from "./routes/public/referral-landing.ts";
import { registerClientPayments } from "./routes/client/payments.ts";
import { registerClientVisits } from "./routes/client/visits.ts";
import { registerClientPhotos } from "./routes/client/photos.ts";
import { registerDevVisits } from "./routes/dev-visits.ts";
import { registerDevMessages } from "./routes/dev-messages.ts";
import { registerDevClock } from "./routes/dev-clock.ts";
import { DEV_CLOCK_HEADER, followDevClock } from "./lib/dev-clock.ts";
import { registerEvolutionHook } from "./routes/hooks/evolution.ts";
import { registerMsg91Hook } from "./routes/hooks/msg91.ts";
import { registerRazorpayHook } from "./routes/hooks/razorpay.ts";
import { registerStopMessages } from "./routes/public/stop-messages.ts";
import { registerCspReports } from "./routes/public/csp-reports.ts";
import { OPS_ROUTES } from "./routes/ops/routes.ts";
import { registerHealth } from "./routes/health.ts";
import { registerPublishedPrices } from "./routes/public/published-prices.ts";
import { registerServedCities } from "./routes/public/served-cities.ts";
import { registerSiteWords } from "./routes/public/site-words.ts";
import { registerReferralReward } from "./routes/public/referral-reward.ts";
import { registerTechAuth } from "./routes/tech/auth.ts";
import { registerTechJobs } from "./routes/tech/jobs.ts";
import { registerTechPieces } from "./routes/tech/pieces.ts";
import { registerTryonClaim } from "./routes/public/tryon-claim.ts";
import { registerTryonGenerate } from "./routes/public/tryon-generate.ts";
import { registerTryonResult } from "./routes/public/tryon-result.ts";
import { registerTryonUpload } from "./routes/public/tryon-upload.ts";
import { keyedWrite } from "./http/idempotency.ts";

/** Routes that report on the database themselves instead of being blocked by it. */
const IDENTITY_EXEMPT_ROUTES = new Set(["/api/health"]);

/**
 * Each surface's routes (docs/decisions/0026-hosts-and-surfaces.md). A route
 * answers only on its own surface's host; anywhere else it is a 404.
 */
const SURFACE_ROUTES: Readonly<Record<Surface, readonly ((app: App) => void)[]>> = {
  public: [
    registerHealth,
    registerPublishedPrices,
    registerServedCities,
    registerSiteWords,
    // A WhatsApp code that proves a number before /book's one visit or /try's gate acts on it.
    registerNumberCodes,
    registerConsultations,
    registerBuildingSuggestions,
    registerLead,
    registerReferralLanding,
    // What a referral earns, for the invite's page and /book (docs/decisions/0107-referral-rewards-in-the-console.md).
    registerReferralReward,
    registerTryonUpload,
    registerTryonGenerate,
    registerTryonClaim,
    registerTryonResult,
    // The page a reminder's or alert's link opens, which stops them without signing in.
    registerStopMessages,
    // A script error on the site's own pages, the booking form's and the try-on's.
    registerClientErrors,
    // What the site's pages' content security policy refused.
    registerCspReports,
    // Webhooks sit on the public host.
    registerEvolutionHook,
    registerMsg91Hook,
    registerRazorpayHook,
  ],
  client: [
    registerHealth,
    // What goes wrong in the app's own page; the console and the technician app have it too.
    registerClientErrors,
    registerClientAuth,
    registerClientMe,
    registerClientProfile,
    registerClientAddress,
    registerClientConsents,
    registerClientNumberChange,
    registerClientDeletionRequest,
    registerClientSessions,
    registerClientVisits,
    registerClientMoveProposals,
    registerClientPhotos,
    registerClientDisputes,
    registerClientProblems,
    registerClientPayments,
    registerClientAvailability,
    registerClientBooking,
    registerClientDiscountCodes,
    registerClientChanges,
    registerClientNotes,
    // Their custom orders, for Home (docs/decisions/0177-custom-orders-in-the-app.md).
    registerClientCustomOrders,
    registerClientRefer,
    registerClientData,
  ],
  ops: OPS_ROUTES,
  tech: [
    registerHealth,
    registerClientErrors,
    registerTechAuth,
    registerTechJobs,
    registerTechPieces,
    registerTechDiscountCodes,
    // The technician's kit (docs/decisions/0164-the-kit-screen.md).
    registerTechKit,
    registerTechMonth,
    registerTechLeave,
    registerTechOptions,
  ],
};

export function createApp(
  config: StaticConfig,
  makeDependencies?: DependencyFactory,
  surface: Surface = "public",
  errors: ErrorTracker | null = null,
): App {
  const app = new OpenAPIHono<AppEnv>({
    // A request that fails its zod schema: name the fields, never echo their values.
    defaultHook: (result, c) => {
      if (result.success) return undefined;
      const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".") || "body"))];
      return refuse(c, "invalid_request", fields);
    },
  });

  const dependencies = makeDependencies ?? productionDependencies(config);
  app.use(
    "*",
    requestContext({
      config,
      makeDependencies: dependencies,
      checkIdentity: createCachedIdentityCheck(),
      readOpsInputs: createCachedOpsInputs(),
      surface,
      errors,
    }),
  );
  app.use("/api/*", requireOwnDatabase);
  // The ops console is staff only: every call needs a valid Access token, and is audited (ADR 0031); then the Staff
  // list decides what the caller may do.
  if (surface === "ops") app.use("/api/*", requireAccess, auditCall, requireStaffAccess, keyedWrite);
  // The public site's writes are guarded by Turnstile; the other surfaces carry session cookies.
  if (surface !== "public") app.use("/api/*", requireSameOrigin);

  app.openAPIRegistry.register("ErrorResponse", ErrorResponseSchema);
  for (const register of SURFACE_ROUTES[surface]) register(app);
  // Locally only, and only when switched on: what stands in for a technician's phone on a laptop (src/routes/dev-visits.ts).
  if (surface === "public" && config.environment === "local" && config.settings.devRoutes) {
    registerDevVisits(app);
    registerDevMessages(app);
    registerDevClock(app);
  }

  app.notFound((c) => refuse(c, "not_found"));
  app.onError((error, c) => {
    // Hono raises a 400 for a body that is not valid JSON.
    if (error instanceof HTTPException && error.status === 400) return refuse(c, "invalid_request", ["body"]);
    // A read D1 failed for a reason that passes by itself, after its tries (src/lib/d1-retry.ts): try again shortly.
    if (c.req.method === "GET" && isTransientD1Error(error)) {
      c.var.log.warn("d1_unavailable", { error });
      return refuse(c, "unavailable");
    }
    c.var.log.error("unhandled_error", { error });
    return refuse(c, "internal_error");
  });

  return app;
}

/**
 * Gives each request an ID, a logger, its dependencies and a metered database; sets common headers; logs the request
 * with what it cost D1 and how long it waited on it. Each error the request logs goes to the error tracker, if any.
 */
function requestContext({
  config,
  makeDependencies,
  checkIdentity,
  readOpsInputs,
  surface,
  errors,
}: {
  config: StaticConfig;
  makeDependencies: DependencyFactory;
  checkIdentity: IdentityCheck;
  readOpsInputs: ReadOpsInputs;
  surface: Surface;
  errors: ErrorTracker | null;
}): MiddlewareHandler<AppEnv> {
  const baseFields = { worker: "mm-api", environment: config.environment, surface };

  return createMiddleware<AppEnv>(async (c, next) => {
    const started = Date.now();
    const requestId = crypto.randomUUID();
    const sink = errors?.sink({
      waitUntil: (sending) => {
        c.executionCtx.waitUntil(sending);
      },
      log: () => log,
    });
    const log = createLogger({ ...baseFields, request_id: requestId }, sink);
    const meter = meterDatabase(c.env.DB);
    c.env = { ...c.env, DB: meter.db };
    c.set("requestId", requestId);
    c.set("log", log);
    c.set("config", config);
    // Locally, a run that moves the clock says on every request how far ahead it is (src/lib/dev-clock.ts).
    if (config.settings.devRoutes) followDevClock(c.req.header(DEV_CLOCK_HEADER));
    c.set("deps", makeDependencies(c.env, log, "request"));
    c.set("checkIdentity", checkIdentity);
    c.set("readOpsInputs", readOpsInputs);
    c.set("surface", surface);

    await next();

    c.header(REQUEST_ID_HEADER, requestId);
    // The apps set their clocks by this header (packages/web-kit/clock.ts), so it says the moved clock where it moves.
    if (config.settings.devRoutes) c.header("Date", c.var.deps.now().toUTCString());
    c.header("X-Content-Type-Options", "nosniff");
    if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
    if (config.environment !== "production") c.header("X-Robots-Tag", "noindex, nofollow");
    const waits = meter.waits();
    // Only to a caller who signed in: before that, how long D1 took could tell a number we know from a new one.
    if (signedIn(c)) c.header("Server-Timing", serverTiming(waits));

    log.info("request", {
      method: c.req.method,
      route: routePath(c, -1), // the pattern, e.g. /api/result/:token; never the path, which can hold a token
      status: c.res.status,
      duration_ms: Date.now() - started,
      ...usageFields(meter.usage()),
      d1_trips: waits.trips,
      d1_wait_ms: waits.ms,
      // The build of the app that called, so a page left open on an old one is told apart (packages/web-kit/build.ts).
      client_version: c.req.header("X-Client-Version")?.slice(0, 40),
    });
  });
}

/** A client or technician with a session, or staff through Cloudflare Access. */
const signedIn = (c: Context<AppEnv>): boolean =>
  c.var.clientSession !== undefined || c.var.technicianSession !== undefined || c.var.accessIdentity !== undefined;

/** Answers 503 unless this Worker's database is marked as its own environment's. */
const requireOwnDatabase = createMiddleware<AppEnv>(async (c, next) => {
  if (IDENTITY_EXEMPT_ROUTES.has(c.req.path)) return next();

  const identity = await c.var.checkIdentity(c.env.DB, c.var.config.environment);
  if (identity.state === "ok") return next();

  if (identity.state === "unreachable") {
    c.var.log.error("database_identity_failed", { state: identity.state, error: identity.error });
    return refuse(c, "unavailable");
  }
  c.var.log.error("database_identity_failed", { state: identity.state });
  return refuse(c, "environment_mismatch");
});
