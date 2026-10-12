// Operations · Usage (docs/decisions/0186-usage-and-shrinkage.md): a flagged technician opened to their items, and a
// kit's losses.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, json, type OpsReply } from "./fixtures.ts";
import { usage as copy } from "../../apps/ops/src/content/usage.ts";

const USAGE = {
  since: "2026-08-24",
  technicians: [
    {
      technician_id: "t-1",
      name: "Imran Qureshi",
      visits: 6,
      expected_value: 3000,
      used_value: 4500,
      over_percent: 50,
      flagged: true,
      items: [{ consumable_code: "solvent", name: "Solvent", expected: 60, used: 90, over_percent: 50 }],
    },
  ],
  places: [
    {
      place_id: "t-1",
      place: "Imran Qureshi",
      kind: "kit",
      left_value: 6000,
      lost_value: 1500,
      write_offs: 3,
      shrinkage_percent: 25,
      count_accuracy_percent: 80,
      flagged: true,
    },
  ],
} satisfies OpsReply<"/api/stock/usage">;

test("opens a flagged technician to their items, beside each place's losses", async ({ page }) => {
  await answer(page, { "GET /api/stock/usage": json(USAGE) });
  await page.goto("/usage");
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
  const technicians = page.getByRole("region", { name: copy.technicians });
  await expect(technicians.getByRole("row").filter({ hasText: "Imran Qureshi" })).toContainText(copy.over(50));
  await technicians.getByRole("button", { name: copy.items("Imran Qureshi") }).click();
  await expect(technicians.getByRole("row").filter({ hasText: "Solvent" })).toContainText("90");
  await expect(page.getByRole("region", { name: copy.places })).toContainText(copy.percent(25));
  expect(await axeViolations(page)).toEqual([]);
});
