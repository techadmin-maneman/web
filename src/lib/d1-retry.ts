// A D1 call tried again after a failure that passes by itself (src/lib/d1-errors.ts). Only for what is safe to send
// twice: a read, or a write that changes nothing the second time. Any other failure is thrown at once.

import { isTransientD1Error } from "./d1-errors.ts";

/** How long each try waits before the next, in milliseconds, before up to half as much again at random. */
const WAITS_MS = [50, 200] as const;

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms + Math.random() * ms * 0.5);
  });

export async function retryTransient<T>(send: () => Promise<T>): Promise<T> {
  for (const wait of WAITS_MS) {
    try {
      return await send();
    } catch (error) {
      if (!isTransientD1Error(error)) throw error;
      await pause(wait);
    }
  }
  return send();
}
