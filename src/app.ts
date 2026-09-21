import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { routePath } from "hono/route";
import { createIdentityGate, type StaticConfig } from "./guard.ts";
import { ErrorResponseSchema, errorBody } from "./http/errors.ts";
import { createLogger, type Logger } from "./log.ts";
import { registerHealth } from "./routes/health.ts";

export type AppEnv = {
  Bindings: Env;
  Variables: {
    requestId: string;
    log: Logger;
    config: StaticConfig;
    verifyIdentity: ReturnType<typeof createIdentityGate>;
  };
};

export type App = OpenAPIHono<AppEnv>;

export const REQUEST_ID_HEADER = "X-Request-Id";

/** Routes that report on the environment themselves rather than being blocked by it. */
const IDENTITY_EXEMPT_ROUTES: ReadonlySet<string> = new Set(["/api/health"]);

export function createApp(config: StaticConfig): App {
  const app = new OpenAPIHono<AppEnv>();
  const baseLog = createLogger({ worker: "mm-api", environment: config.environment });
  const verifyIdentity = createIdentityGate();

  // Request context: ID, logger, response headers, access log.
  app.use("*", async (c: Context<AppEnv>, next) => {
    const started = Date.now();
    const requestId = crypto.randomUUID();
    const log = baseLog.child({ request_id: requestId });
    c.set("requestId", requestId);
    c.set("log", log);
    c.set("config", config);
    c.set("verifyIdentity", verifyIdentity);

    await next();

    c.header(REQUEST_ID_HEADER, requestId);
    c.header("X-Content-Type-Options", "nosniff");
    if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
    if (config.environment !== "production") c.header("X-Robots-Tag", "noindex, nofollow");

    // The route pattern, never the raw path: paths can carry tokens.
    log.info("request", {
      method: c.req.method,
      route: routePath(c, -1),
      status: c.res.status,
      duration_ms: Date.now() - started,
    });
  });

  // No request is served against a database that cannot prove it belongs here.
  app.use("/api/*", async (c, next) => {
    if (IDENTITY_EXEMPT_ROUTES.has(c.req.path)) {
      await next();
      return;
    }
    const identity = await verifyIdentity(c.env.DB, config.environment);
    if (identity.state !== "ok") {
      c.var.log.error("database_identity_failed", {
        state: identity.state,
        ...(identity.state === "unreachable" ? { error: identity.error } : {}),
      });
      const code = identity.state === "unreachable" ? "unavailable" : "environment_mismatch";
      return c.json(errorBody(code, c.var.requestId), 503);
    }
    await next();
    return undefined;
  });

  app.openAPIRegistry.register("ErrorResponse", ErrorResponseSchema);
  registerHealth(app);

  app.notFound((c) => c.json(errorBody("not_found", c.var.requestId), 404));

  app.onError((error, c) => {
    c.var.log.error("unhandled_error", { error });
    return c.json(errorBody("internal_error", c.var.requestId), 500);
  });

  return app;
}
