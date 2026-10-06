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
import { createCachedOpsInputs, type ReadOpsInputs } from "./domain/ops/ops-settings.ts";
import { requireAccess } from "./http/access.ts";
import { requireStaffAccess } from "./http/staff-access.ts";
import { REQUEST_ID_HEADER, type App, type AppEnv } from "./http/context.ts";
import { ErrorResponseSchema, refuse } from "./http/errors.ts";
import { requireSameOrigin } from "./http/origin.ts";
import { meterDatabase, serverTiming, usageFields } from "./lib/d1-meter.ts";
import { createLogger } from "./log.ts";
import { registerClientAuth } from "./routes/client/auth.ts";
import { registerClientMe } from "./routes/client/me.ts";
import { registerClientDeletionRequest, registerClientProfile } from "./routes/client/profile.ts";
import { registerClientAddress } from "./routes/client/address.ts";
import { registerClientConsents } from "./routes/client/consents.ts";
import { registerClientNumberChange } from "./routes/client/number-change.ts";
import { registerClientSessions } from "./routes/client/sessions.ts";
import { registerClientBooking } from "./routes/client/booking.ts";
import { registerClientChanges } from "./routes/client/changes.ts";
import { registerClientNotes } from "./routes/client/notes.ts";
import { registerClientData } from "./routes/client/data.ts";
import { registerClientDiscountCodes } from "./routes/client/discount-codes.ts";
import { registerOpsDiscountCodes } from "./routes/ops/discount-codes.ts";
import { registerTechDiscountCodes } from "./routes/tech/discount-codes.ts";
import { registerClientDisputes } from "./routes/client/disputes.ts";
import { registerClientErrors } from "./routes/client-errors.ts";
import { registerClientRefer } from "./routes/client/refer.ts";
import { registerOpsBlackouts } from "./routes/ops/blackouts.ts";
import { registerOpsClientAddress } from "./routes/ops/client-address.ts";
import { registerOpsClientConsents } from "./routes/ops/client-consents.ts";
import { registerOpsClientPhotos } from "./routes/ops/client-photos.ts";
import { registerOpsClientRecord } from "./routes/ops/client-record.ts";
import { registerOpsClientReferral } from "./routes/ops/client-referral.ts";
import { registerOpsClients } from "./routes/ops/clients.ts";
import { registerOpsConsumables } from "./routes/ops/consumables.ts";
import { registerOpsCredits } from "./routes/ops/credits.ts";
import { registerOpsDispatch } from "./routes/ops/dispatch.ts";
import { registerOpsDisputes } from "./routes/ops/disputes.ts";
import { registerOpsErasure } from "./routes/ops/erasure.ts";
import { registerOpsField } from "./routes/ops/field.ts";
import { registerOpsNoShows } from "./routes/ops/no-shows.ts";
import { registerOpsClientPieces } from "./routes/ops/client-pieces.ts";
import { registerOpsTechnicianLeave } from "./routes/ops/technician-leave.ts";
import { registerOpsTechnicianPhones } from "./routes/ops/technician-phones.ts";
import { registerOpsGrievances } from "./routes/ops/grievances.ts";
import { registerOpsHairProfile } from "./routes/ops/hair-profile.ts";
import { registerOpsJobSheet } from "./routes/ops/job-sheet.ts";
import { registerOpsPaymentLinks } from "./routes/ops/payment-links.ts";
import { registerOpsNoShowRulings } from "./routes/ops/no-show-rulings.ts";
import { registerOpsPayments } from "./routes/ops/payments.ts";
import { registerOpsReferrals } from "./routes/ops/referrals.ts";
import { registerOpsTasks } from "./routes/ops/tasks.ts";
import { registerOpsAlerts } from "./routes/ops/alerts.ts";
import { registerOpsTechnicians } from "./routes/ops/technicians.ts";
import { registerOpsServices } from "./routes/ops/services.ts";
import { registerOpsSettings } from "./routes/ops/settings.ts";
import { registerOpsSlotTimes } from "./routes/ops/slot-times.ts";
import { registerOpsStaff } from "./routes/ops/staff.ts";
import { registerOpsStock } from "./routes/ops/stock.ts";
import { registerOpsWaitlist } from "./routes/ops/waitlist.ts";
import { registerConsultations } from "./routes/public/consultations.ts";
import { registerNumberCodes } from "./routes/public/number-codes.ts";
import { registerReferralLanding } from "./routes/public/referral-landing.ts";
import { registerClientPayments } from "./routes/client/payments.ts";
import { registerClientVisits } from "./routes/client/visits.ts";
import { registerClientPhotos } from "./routes/client/photos.ts";
import { registerDevVisits } from "./routes/dev-visits.ts";
import { registerEvolutionHook } from "./routes/hooks/evolution.ts";
import { registerRazorpayHook } from "./routes/hooks/razorpay.ts";
import { registerStopMessages } from "./routes/public/stop-messages.ts";
import { registerHealth } from "./routes/health.ts";
import { registerOpsProfile } from "./routes/ops/profile.ts";
import { registerOpsStorage } from "./routes/ops/storage.ts";
import { registerOpsVisitChanges } from "./routes/ops/visit-changes.ts";
import { registerOpsVisits } from "./routes/ops/visits.ts";
import { registerOpsWhoami } from "./routes/ops/whoami.ts";
import { registerPublishedPrices } from "./routes/public/published-prices.ts";
import { registerReferralReward } from "./routes/public/referral-reward.ts";
import { registerTechAuth } from "./routes/tech/auth.ts";
import { registerTechJobs } from "./routes/tech/jobs.ts";
import { registerTechPieces } from "./routes/tech/pieces.ts";
import { registerTryonClaim } from "./routes/public/tryon-claim.ts";
import { registerTryonGenerate } from "./routes/public/tryon-generate.ts";
import { registerTryonResult } from "./routes/public/tryon-result.ts";
import { registerTryonUpload } from "./routes/public/tryon-upload.ts";

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
    // A WhatsApp code that proves a number before /book's one visit or /try's gate acts on it.
    registerNumberCodes,
    registerConsultations,
    registerReferralLanding,
    // What a referral earns, for the invite's page and /book (docs/decisions/0107-referral-rewards-in-the-console.md).
    registerReferralReward,
    registerTryonUpload,
    registerTryonGenerate,
    registerTryonClaim,
    registerTryonResult,
    // The page a reminder's or alert's link opens, which stops them without signing in.
    registerStopMessages,
    // Webhooks sit on the public host (ADR 0026).
    registerEvolutionHook,
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
    registerClientPhotos,
    // After the visits: they put the session on every /api/visits/* route.
    registerClientDisputes,
    registerClientPayments,
    registerClientBooking,
    // After the booking: it puts the session and the self-serve switch on every /api/holds/* route.
    registerClientDiscountCodes,
    registerClientChanges,
    // After the changes: they put the session and the self-serve switch on every /api/appointments/* route.
    registerClientNotes,
    registerClientRefer,
    registerClientData,
  ],
  ops: [
    registerHealth,
    registerClientErrors,
    registerOpsClients,
    registerOpsClientRecord,
    registerOpsClientPhotos,
    registerOpsClientConsents,
    registerOpsCredits,
    // A visit ops book for a client: at once, or by a payment link.
    registerOpsVisits,
    // A visit ops cancel for a client, or close by hand for a technician whose phone was lost.
    registerOpsVisitChanges,
    registerOpsClientReferral,
    // An address a client gives ops on the phone (docs/decisions/0092-task-owners.md).
    registerOpsClientAddress,
    // A client's hair profile (docs/decisions/0106-a-clients-hair-profile.md).
    registerOpsHairProfile,
    // Erasing a client from their page, the day they ask.
    registerOpsErasure,
    registerOpsProfile,
    registerOpsReferrals,
    registerOpsGrievances,
    registerOpsWaitlist,
    registerOpsDispatch,
    registerOpsNoShows,
    registerOpsClientPieces,
    registerOpsField,
    registerOpsTechnicianLeave,
    registerOpsTechnicianPhones,
    registerOpsNoShowRulings,
    registerOpsDisputes,
    registerOpsTasks,
    // The alerts on Tasks' "Needs a hand".
    registerOpsAlerts,
    registerOpsPayments,
    // A one visit's payment link texted to the client again.
    registerOpsPaymentLinks,
    registerOpsTechnicians,
    registerOpsSettings,
    // The day's half-slot times, from a day nothing is booked or bookable on (docs/decisions/0102-window-times.md).
    registerOpsSlotTimes,
    // The days no visit is offered (docs/decisions/0088-every-policy-in-the-console.md).
    registerOpsBlackouts,
    // The services clients book (docs/decisions/0085-services-ops-can-edit.md).
    registerOpsServices,
    // The consumables, the job sheet and the stock (docs/decisions/0087-consumables-and-stock.md).
    registerOpsConsumables,
    registerOpsJobSheet,
    registerOpsStock,
    // What the photographs and cards hold in R2 (docs/decisions/0093-the-storage-meter.md).
    registerOpsStorage,
    registerOpsWhoami,
    // Discount codes, and a code on a client's visit (docs/decisions/0108-discount-codes.md).
    registerOpsDiscountCodes,
    // Who may do what in the console.
    registerOpsStaff,
  ],
  // The discount code after the jobs, which put the technician's session on every /api/tech/jobs/* route.
  tech: [
    registerHealth,
    registerClientErrors,
    registerTechAuth,
    registerTechJobs,
    registerTechPieces,
    registerTechDiscountCodes,
  ],
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
    }),
  );
  app.use("/api/*", requireOwnDatabase);
  // The ops console is staff only: every call needs a valid Access token, and is audited (ADR 0031); then the Staff
  // list decides what the caller may do.
  if (surface === "ops") app.use("/api/*", requireAccess, auditCall, requireStaffAccess);
  // The public site's writes are guarded by Turnstile; the other surfaces carry session cookies.
  if (surface !== "public") app.use("/api/*", requireSameOrigin);

  app.openAPIRegistry.register("ErrorResponse", ErrorResponseSchema);
  for (const register of SURFACE_ROUTES[surface]) register(app);
  // Locally only, and only when switched on: what stands in for a technician's phone on a laptop (src/routes/dev-visits.ts).
  if (surface === "public" && config.environment === "local" && config.settings.devRoutes) registerDevVisits(app);

  app.notFound((c) => refuse(c, "not_found"));
  app.onError((error, c) => {
    // Hono raises a 400 for a body that is not valid JSON.
    if (error instanceof HTTPException && error.status === 400) {
      return refuse(c, "invalid_request", ["body"]);
    }
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
 * with what it cost D1 and how long it waited on it.
 */
function requestContext({
  config,
  makeDependencies,
  checkIdentity,
  readOpsInputs,
  surface,
}: {
  config: StaticConfig;
  makeDependencies: DependencyFactory;
  checkIdentity: IdentityCheck;
  readOpsInputs: ReadOpsInputs;
  surface: Surface;
}): MiddlewareHandler<AppEnv> {
  const baseLog = createLogger({ worker: "mm-api", environment: config.environment, surface });

  return createMiddleware<AppEnv>(async (c, next) => {
    const started = Date.now();
    const requestId = crypto.randomUUID();
    const log = baseLog.child({ request_id: requestId });
    const meter = meterDatabase(c.env.DB);
    c.env = { ...c.env, DB: meter.db };
    c.set("requestId", requestId);
    c.set("log", log);
    c.set("config", config);
    c.set("deps", makeDependencies(c.env, log, "request"));
    c.set("checkIdentity", checkIdentity);
    c.set("readOpsInputs", readOpsInputs);
    c.set("surface", surface);

    await next();

    c.header(REQUEST_ID_HEADER, requestId);
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
