// What a consumable and a hair system cost and are low at, as ops send them (src/routes/ops/consumables.ts,
// src/routes/ops/hair-systems.ts).

import { z } from "@hono/zod-openapi";
import { CONSUMABLE_BOUNDS } from "../../config/consumables.ts";

export const UnitCost = z
  .number()
  .int()
  .min(0)
  .max(CONSUMABLE_BOUNDS.maxUnitCost)
  .openapi({ description: "In paise." });

export const Level = z.union([z.number().int().min(0).max(CONSUMABLE_BOUNDS.maxReorderLevel), z.null()]);

/** Days from delivery to expiry; null for a stock code that does not expire. Five years at most. */
export const ShelfLife = z.union([z.number().int().min(1).max(1830), z.null()]);
