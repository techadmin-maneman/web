// Settings' pages no browser test opened: each opens on its own heading and passes axe, as the rest are checked. What
// the fixtures do not answer, the local API does.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { open } from "./settings-fixtures.ts";
import type { SettingsTab } from "../../apps/ops/src/route.ts";
import { states } from "../../apps/ops/src/content.ts";
import { settings } from "../../apps/ops/src/content/settings.ts";

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

// A group whose rules each hold several figures draws a panel for each rule and none for the group, which would be
// empty: Care hours shows Customer Care hours, Remedies without approval and WhatsApp refused, under no empty heading.
// Read from the local API, whose rules are the register's own.
test("draws no empty panel above a group of rules that each hold several figures", async ({ page }) => {
  await page.goto("/settings/care-hours");
  await expect(page.getByRole("region", { name: "Customer Care hours", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: settings.rules.groups.care, exact: true })).toHaveCount(0);
});
