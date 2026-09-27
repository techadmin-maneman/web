import type { Context } from "hono";
import type { AppEnv } from "./context.ts";

/**
 * Runs `work` once the response has gone, where the runtime allows (Workers'
 * waitUntil). Without an execution context, as in most tests, it runs first.
 * `work` must catch its own errors.
 */
export async function afterResponse(c: Context<AppEnv>, work: Promise<unknown>): Promise<void> {
  let waitUntil: ((promise: Promise<unknown>) => void) | undefined;
  try {
    const context = c.executionCtx;
    waitUntil = context.waitUntil.bind(context);
  } catch {
    waitUntil = undefined; // Hono throws when the request came without one
  }
  if (waitUntil === undefined) await work;
  else waitUntil(work);
}
