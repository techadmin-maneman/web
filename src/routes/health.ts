import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../http/context.ts";
import { ENVIRONMENTS } from "../config/environments.ts";
import { lastCompletedAt } from "../domain/platform/cron-runs.ts";
import type { Logger } from "../log.ts";

// The commit the bundle was built from, defined at upload (scripts/lib/release.ts); undeclared locally and in tests.
declare const BUILD_SHA: string | undefined;
const COMMIT = typeof BUILD_SHA === "string" ? BUILD_SHA : null;

export const HealthSchema = z
  .object({
    status: z.enum(["ok", "unavailable"]),
    environment: z.enum(ENVIRONMENTS),
    version_id: z.string().openapi({ description: "Cloudflare Worker version ID serving this request." }),
    version_tag: z
      .string()
      .nullable()
      .openapi({ description: "Tag given at upload: the git commit SHA in remote environments." }),
    commit: z
      .string()
      .nullable()
      .openapi({
        description:
          "The git commit the code was built from, baked in at upload. A secret change publishes an untagged version " +
          "of the same code, so this still names what is live when version_tag is null. Null in a local run.",
      }),
    d1: z.enum(["ok", "unmarked", "mismatch", "unreachable"]).openapi({
      description:
        "ok: reachable and marked as this environment's database. unmarked: no identity row. mismatch: marked as another environment's database.",
    }),
    cron_completed_at: z.string().nullable().openapi({
      description:
        "When the five-minute cron last finished a run; null before its first, or when the database is not this environment's. Information only: status does not depend on it.",
    }),
  })
  .strict()
  .openapi("Health");
type Health = z.infer<typeof HealthSchema>;

const healthRoute = createRoute({
  method: "get",
  path: "/api/health",
  summary: "Environment, version and database reachability",
  responses: {
    200: { description: "Healthy", content: { "application/json": { schema: HealthSchema } } },
    503: {
      description: "The database is unreachable or belongs to another environment",
      content: { "application/json": { schema: HealthSchema } },
    },
  },
});

/** Never a reason for the check to fail. */
async function cronCompletedAt(db: D1Database, log: Logger): Promise<string | null> {
  try {
    return await lastCompletedAt(db);
  } catch (error) {
    log.warn("cron_run_unreadable", { error });
    return null;
  }
}

export function registerHealth(app: App): void {
  app.openapi(healthRoute, async (c) => {
    const identity = await c.var.checkIdentity(c.env.DB, c.var.config.environment);
    const version = c.env.CF_VERSION_METADATA;
    const body: Health = {
      status: identity.state === "ok" ? "ok" : "unavailable",
      environment: c.var.config.environment,
      version_id: version.id,
      version_tag: version.tag === "" ? null : version.tag,
      commit: COMMIT,
      d1: identity.state,
      cron_completed_at: identity.state === "ok" ? await cronCompletedAt(c.env.DB, c.var.log) : null,
    };
    if (identity.state !== "ok") {
      c.var.log.error("health_unavailable", { d1: identity.state });
      return c.json(body, 503);
    }
    return c.json(body, 200);
  });
}
