// A client rates a visit done (docs/decisions/0260-ratings.md): five stars on the visit's page, given once; a low one's
// thanks points to reporting what went wrong, and the visit's page shows the stars from then on. The visit and the
// rating's answers are faked, so each test starts from an unrated visit however often it runs, beside whichever other
// test; the server's side is test/worker/app/client-ratings.test.ts.

import type { Page } from "@playwright/test";
import { PORTS } from "../../scripts/lib/local-stack.ts";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fittedClient } from "./fitted.ts";
import { logIn } from "./signed-in.ts";
import * as appCopy from "../../apps/app/src/content.ts";

const copy = appCopy.visits.detail.rating;

type Rating = { stars: number; at: string; low: boolean };

/**
 * The fitted client's service visit, read unrated and open to rating until `rated()` gives its rating. Only the browser
 * resolves app.localhost, so the visit is fetched from the app's server by its address.
 */
async function visitAnswered(page: Page, id: string, rated: () => Rating | null): Promise<void> {
  await page.route(`**/api/visits/${id}`, async (route) => {
    const answer = await route.fetch({
      url: `http://127.0.0.1:${String(PORTS.app)}/api/visits/${id}`,
      headers: { ...route.request().headers(), host: `app.localhost:${String(PORTS.app)}` },
    });
    const visit = (await answer.json()) as Record<string, unknown>;
    const rating = rated();
    await route.fulfill({ response: answer, json: { ...visit, rating, rateable: rating === null } });
  });
}

async function openVisit(page: Page): Promise<string> {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await page.getByRole("navigation", { name: appCopy.shell.tabsLabel }).waitFor();
  return client.service.id;
}

test("rates a past visit once, and under four points to reporting what went wrong", async ({ page }) => {
  const id = await openVisit(page);
  let given: Rating | null = null;
  await visitAnswered(page, id, () => given);
  await page.route(`**/api/visits/${id}/rating`, async (route) => {
    const { stars } = route.request().postDataJSON() as { stars: number };
    given = { stars, at: new Date().toISOString(), low: stars < 4 };
    await route.fulfill({ status: 201, json: given });
  });
  await page.goto(`/visits/${id}`);

  await expect(page.getByRole("heading", { level: 2, name: copy.title })).toBeVisible();
  const stars = page.getByRole("group", { name: copy.label });
  expect(await axeViolations(page)).toEqual([]);
  await stars.getByRole("button", { name: copy.star(3) }).click();

  await expect(page.getByText(copy.low)).toBeVisible();
  await expect(page.getByRole("link", { name: copy.report, exact: true })).toHaveAttribute(
    "href",
    `/visits/issues/new?visit=${id}`,
  );
  await page.reload();
  await expect(page.getByRole("img", { name: copy.star(3) })).toBeVisible();
  await expect(page.getByRole("group", { name: copy.label })).toHaveCount(0);
});

test("shows the stars the visit kept when a tap's answer was lost, and no failure line under them", async ({
  page,
}) => {
  const id = await openVisit(page);
  // The first tap's answer is lost; the next is refused, the visit having its rating; the visit is then read with it.
  let kept: Rating | null = null;
  await visitAnswered(page, id, () => kept);
  let lost = false;
  await page.route(`**/api/visits/${id}/rating`, (route) => {
    if (!lost) {
      lost = true;
      return route.abort();
    }
    kept = { stars: 5, at: new Date().toISOString(), low: false };
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
