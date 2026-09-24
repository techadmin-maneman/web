// What the "one tap per intent" tests all need: a round trip held open, so the second tap lands
// inside the first's, where an anxious client's lands. Against the local API a write answers in
// microseconds; in production it is a call to WhatsApp, Google or Razorpay, hundreds of
// milliseconds wide, and that width is the gap these tests stand in for
// (docs/decisions/0058-one-tap-per-intent.md).

import type { Page } from "@playwright/test";

export interface Held {
  /** How many matching requests the app has sent. */
  readonly asked: () => number;
}

/**
 * Holds every request matching `pattern` until a second one joins it, or two seconds pass, and
 * then lets them go together. Two requests let go together is what a second tap looks like when
 * the first is still in flight, made certain.
 */
export async function holdOpen(page: Page, pattern: string): Promise<Held> {
  let asked = 0;
  const waiting: (() => void)[] = [];
  const letGo = () => {
    for (const release of waiting.splice(0)) release();
  };
  await page.route(pattern, async (route) => {
    asked += 1;
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
      if (waiting.length >= 2) letGo();
      else setTimeout(letGo, 2_000);
    });
    await route.continue();
  });
  return { asked: () => asked };
}
