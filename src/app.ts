import { OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { routePath } from "hono/route";
import { createCachedIdentityCheck, type IdentityCheck, type StaticConfig } from "./guard.ts";
import { ErrorResponseSchema, errorBody } from "./http/errors.ts";
import { createLogger, type Logger } from "./log.ts";
import { registerHealth } from "./routes/health.ts";

/** What every handler can read from `c.env` and `c.var`. */
export type AppEnv = {
  Bindings: Env;
  Variables: {
    requestId: string;
    log: Logger;
    config: StaticConfig;
    checkIdentity: IdentityCheck;
  };
};

export type App = OpenAPIHono<AppEnv>;

export const REQUEST_ID_HEADER = "X-Request-Id";

/** Routes that report on the database themselves instead of being blocked by it. */
const IDENTITY_EXEMPT_ROUTES = new Set(["/api/health"]);

export function createApp(config: StaticConfig): App {
  const app = new OpenAPIHono<AppEnv>();

  app.use("*", requestContext(config, createCachedIdentityCheck()));
  app.use("/api/*", requireOwnDatabase);

  app.openAPIRegistry.register("ErrorResponse", ErrorResponseSchema);
  registerHealth(app);

  app.notFound((c) => c.json(errorBody("not_found", c.var.requestId), 404));
  app.onError((error, c) => {
    c.var.log.error("unhandled_error", { error });
    return c.json(errorBody("internal_error", c.var.requestId), 500);
  });

  return app;
}

/** Gives each request an ID and a logger, sets common headers, and logs the request. */
function requestContext(config: StaticConfig, checkIdentity: IdentityCheck): MiddlewareHandler<AppEnv> {
  const baseLog = createLogger({ worker: "mm-api", environment: config.environment });

  return createMiddleware<AppEnv>(async (c, next) => {
    const started = Date.now();
    const requestId = crypto.randomUUID();
    const log = baseLog.child({ request_id: requestId });
    c.set("requestId", requestId);
    c.set("log", log);
    c.set("config", config);
    c.set("checkIdentity", checkIdentity);

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
