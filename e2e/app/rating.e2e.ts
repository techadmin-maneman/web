// A client rates a visit done (docs/decisions/0260-ratings.md): five stars on the visit's page, given once; under four,
// the thanks points to reporting what went wrong, and the visit's page shows the stars from then on.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fittedClient } from "./fitted.ts";
import { logIn } from "./signed-in.ts";
import * as appCopy from "../../apps/app/src/content.ts";

const copy = appCopy.visits.detail.rating;

test("rates a past visit once, and under four points to reporting what went wrong", async ({ page }) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await page.getByRole("navigation", { name: appCopy.shell.tabsLabel }).waitFor();
  await page.goto(`/visits/${client.service.id}`);

  await expect(page.getByRole("heading", { level: 2, name: copy.title })).toBeVisible();
  const stars = page.getByRole("group", { name: copy.label });
  expect(await axeViolations(page)).toEqual([]);
  await stars.getByRole("button", { name: copy.star(3) }).click();

  await expect(page.getByText(copy.low)).toBeVisible();
  await expect(page.getByRole("link", { name: copy.report, exact: true })).toHaveAttribute(
    "href",
    `/visits/issues/new?visit=${client.service.id}`,
  );
  await page.reload();
  await expect(page.getByRole("img", { name: copy.star(3) })).toBeVisible();
  await expect(page.getByRole("group", { name: copy.label })).toHaveCount(0);
});
