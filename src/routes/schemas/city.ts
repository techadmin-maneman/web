// The city a console read is narrowed to, as the header's picker asks it: within the caller's own cities, never past
// them (ADR 0228).

import { z } from "@hono/zod-openapi";

export const CityAsked = z.string().trim().min(1).max(60).optional().openapi({
  description: "One city to narrow to, within those the caller's grants reach; every city they reach when left out.",
  example: "Gurgaon",
});
