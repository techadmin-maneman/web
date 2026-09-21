import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../app.ts";
import { ENVIRONMENTS } from "../config/environments.ts";

export const HealthSchema = z
  .object({
    status: z.enum(["ok", "unavailable"]),
    environment: z.enum(ENVIRONMENTS),
    version_id: z.string().openapi({ description: "Cloudflare Worker version ID serving this request." }),
    version_tag: z
      .string()
      .nullable()
      .openapi({ description: "Tag given at upload: the git commit SHA in remote environments." }),
    d1: z.enum(["ok", "unmarked", "mismatch", "unreachable"]).openapi({
      description:
        "ok: reachable and marked as this environment's database. unmarked: no identity row. mismatch: marked as another environment's database.",
    }),
  })
  .strict()
  .openapi("Health");
export type Health = z.infer<typeof HealthSchema>;

export const healthRoute = createRoute({
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

export function registerHealth(app: App): void {
  app.openapi(healthRoute, async (c) => {
    const identity = await c.var.verifyIdentity(c.env.DB, c.var.config.environment);
    const version = c.env.CF_VERSION_METADATA;
    const body: Health = {
      status: identity.state === "ok" ? "ok" : "unavailable",
      environment: c.var.config.environment,
      version_id: version.id,
      version_tag: version.tag === "" ? null : version.tag,
      d1: identity.state,
    };
    if (identity.state !== "ok") {
      c.var.log.error("health_unavailable", { d1: identity.state });
      return c.json(body, 503);
    }
    return c.json(body, 200);
  });
}
