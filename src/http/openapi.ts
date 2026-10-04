// What every route definition repeats (@hono/zod-openapi). A refusal's response is errorResponse in ./errors.ts.

import { z } from "@hono/zod-openapi";
import { MOST_NAME_LENGTH, isPersonName } from "@maneman/web-kit/names";

/** A JSON body described by `schema`: a route's request body, or one of its responses. */
export const json = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } } });

/** A name typed into a public form: letters only, as the site checks it too (packages/web-kit/names.ts). */
export const PersonNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MOST_NAME_LENGTH)
  .refine(isPersonName)
  .openapi({ description: "Letters, spaces, dots, apostrophes and hyphens, starting with a letter." });
