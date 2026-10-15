// The address form the site's booking and the referral landing ask for, filled in as a visitor would.

import type { Page } from "@playwright/test";
import { referral } from "../site/src/content/referral.ts";

/**
 * The consultation's address as a visitor types it (docs/decisions/0081-the-site-takes-the-address.md): the flat,
 * the building and the area. The city is already the pincode's, and the pincode the one checked.
 */
export async function fillAddress(page: Page): Promise<void> {
  await page.getByLabel(referral.address.labels.flat).fill("Flat 402");
  await page.getByLabel(referral.address.labels.line1).fill("Palm Grove Society");
  await page.getByLabel(referral.address.labels.locality).fill("Sector 65");
}
