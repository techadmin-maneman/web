// What every route definition repeats (@hono/zod-openapi). A refusal's response is errorResponse in ./errors.ts.

import type { z } from "@hono/zod-openapi";

/** A JSON body described by `schema`: a route's request body, or one of its responses. */
export const json = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } } });
