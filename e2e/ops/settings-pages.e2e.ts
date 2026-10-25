// Settings' pages no browser test opened: each opens on its own heading and passes axe, as the rest are checked. What
// the fixtures do not answer, the local API does.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { open } from "./settings-fixtures.ts";
import type { SettingsTab } from "../../apps/ops/src/route.ts";
import { states } from "../../apps/ops/src/content.ts";

const PAGES = [
  "window-times",
  "try-on",
  "care-team",
  "care-hours",
  "remedies",
  "quick-replies",
  "stock",
  "purchasing",
  "supply-plan",
  "limits",
  "reports",
] as const satisfies readonly SettingsTab[];

for (const tab of PAGES) {
  test(`opens Settings · ${tab}, and passes axe`, async ({ page }) => {
    await open(page, `/settings/${tab}`);
    await expect(page.getByText(states.failed)).toHaveCount(0);
    expect(await axeViolations(page)).toEqual([]);
  });
}
