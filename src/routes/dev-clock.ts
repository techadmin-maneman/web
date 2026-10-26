// PUT /api/dev/clock — locally only. Sets the API's clock (src/lib/dev-clock.ts), so a timelapse can play months of
// bookings, visits and cron runs in minutes (e2e/timelapse/). GET says what it reads.
//
// It exists only where DEV_ROUTES is on, which the startup guard refuses outside local, and only local apps register
// it (src/app.ts). It is in no API document: nothing but a developer's run calls it.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../http/context.ts";
import { devNow, setDevClock } from "../lib/dev-clock.ts";

const ClockSchema = z.object({ at: z.iso.datetime() }).strict();

const setRoute = createRoute({
  method: "put",
  path: "/api/dev/clock",
  summary: "Locally only: sets the API's clock",
  request: { body: { required: true, content: { "application/json": { schema: ClockSchema } } } },
  responses: {
    200: { description: "The clock as it now reads", content: { "application/json": { schema: ClockSchema } } },
  },
});

const readRoute = createRoute({
  method: "get",
  path: "/api/dev/clock",
  summary: "Locally only: what the API's clock reads",
  responses: { 200: { description: "The clock", content: { "application/json": { schema: ClockSchema } } } },
});

export function registerDevClock(app: App): void {
  app.openapi(setRoute, (c) => {
    setDevClock(Date.parse(c.req.valid("json").at));
    return c.json({ at: devNow().toISOString() }, 200);
  });
  app.openapi(readRoute, (c) => c.json({ at: devNow().toISOString() }, 200));
}
