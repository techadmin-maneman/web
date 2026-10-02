// What a browser refuses under a page's content security policy, as the page itself reports it. Only the page's own
// frame counts: a frame from another origin, such as Razorpay's payment page or Turnstile's widget, answers to that
// origin's policy, not ours.

import type { Page } from "@playwright/test";

/** Starts recording before the page loads. The list fills as each refusal happens, as its directive and what it blocked. */
export async function recordPolicyRefusals(page: Page): Promise<string[]> {
  const refused: string[] = [];
  await page.exposeBinding("reportPolicyRefusal", ({ frame }, refusal: string) => {
    if (frame === page.mainFrame()) refused.push(refusal);
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const reporter = window as unknown as { reportPolicyRefusal: (refusal: string) => void };
      reporter.reportPolicyRefusal(`${event.effectiveDirective} ${event.blockedURI}`);
    });
  });
  return refused;
}
