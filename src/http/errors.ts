// Errors returned to clients carry a stable code and the request ID. Never a
// stack trace, never a provider's message.

import { z } from "@hono/zod-openapi";

export const ERROR_CODES = [
  "not_found",
  "invalid_request",
  "turnstile_failed",
  "rate_limited",
  "idempotency_in_progress",
  "idempotency_key_reused",
  "environment_mismatch",
  "unavailable",
  "internal_error",
  // Try-on (docs/decisions/0014-try-on-api.md).
  "busy",
  "photo_invalid_file",
  "upload_already_received",
  "upload_missing",
  "session_required",
  "job_not_claimable",
  "look_limit_reached",
  // Erasure (docs/decisions/0019-erasure.md).
  "unauthorized",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.enum(ERROR_CODES),
        request_id: z.string(),
        fields: z
          .array(z.string())
          .optional()
          .openapi({ description: "invalid_request only: the fields that failed validation, never their values." }),
      })
      .strict(),
  })
  .strict()
  .openapi("ErrorResponse");
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export function errorBody(code: ErrorCode, requestId: string, fields?: readonly string[]): ErrorResponse {
  return fields === undefined
    ? { error: { code, request_id: requestId } }
    : { error: { code, request_id: requestId, fields: [...fields] } };
}

/** The OpenAPI entry for an error response. */
export function errorResponse(description: string) {
  return { description, content: { "application/json": { schema: ErrorResponseSchema } } } as const;
}
