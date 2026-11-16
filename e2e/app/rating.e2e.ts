// A client rates a visit done (docs/decisions/0260-ratings.md): five stars on the visit's page, given once; under four,
// the thanks points to reporting what went wrong, and the visit's page shows the stars from then on.

import { PORTS } from "../../scripts/lib/local-stack.ts";
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

test("shows the stars the visit kept when a tap's answer was lost, and no failure line under them", async ({
  page,
}) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await page.getByRole("navigation", { name: appCopy.shell.tabsLabel }).waitFor();
  const id = client.service.id;
  // The first tap's answer is lost; the next is refused, the visit having its rating; the visit is then read with it.
  // Only the browser resolves app.localhost, so the visit is fetched from the app's server by its address.
  let refused = false;
  await page.route(`**/api/visits/${id}`, async (route) => {
    const answer = await route.fetch({
      url: `http://127.0.0.1:${String(PORTS.app)}/api/visits/${id}`,
      headers: { ...route.request().headers(), host: `app.localhost:${String(PORTS.app)}` },
    });
    const visit = (await answer.json()) as Record<string, unknown>;
    const kept = { rating: { stars: 5, at: new Date().toISOString(), low: false }, rateable: false };
    await route.fulfill({ response: answer, json: refused ? { ...visit, ...kept } : visit });
  });
  let lost = false;
  await page.route(`**/api/visits/${id}/rating`, (route) => {
    if (!lost) {
      lost = true;
      return route.abort();
    }
    refused = true;
    return route.fulfill({ status: 409, json: { error: { code: "already_rated", request_id: "e2e" } } });
  });
  await page.goto(`/visits/${id}`);
  const stars = page.getByRole("group", { name: copy.label });
  await stars.getByRole("button", { name: copy.star(5) }).click();
  await expect(page.getByText(copy.failed)).toBeVisible();
  await stars.getByRole("button", { name: copy.star(5) }).click();
  await expect(page.getByRole("img", { name: copy.star(5) })).toBeVisible();
  await expect(page.getByText(copy.thanks)).toBeVisible();
  await expect(page.getByText(copy.failed)).toHaveCount(0);
});
