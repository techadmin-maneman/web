// The client's issue log (docs/decisions/0259-the-issue-log.md; src/routes/client/problems.ts, problem-log.ts): a
// fitted client raises an issue about a visit, from the visit's page, by category and in their words; it opens on its
// own page with its reference, takes an update, and their word that it is sorted; Visits lists it with where it stands.

import { readFileSync } from "node:fs";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fittedClient } from "./fitted.ts";
import { logIn } from "./signed-in.ts";
import * as appCopy from "../../apps/app/src/content.ts";
import { fullDate } from "../../packages/web-kit/dates.ts";

const copy = appCopy.issues;

test("raises an issue about a visit, then updates it and says it is sorted, each in its log", async ({ page }) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await page.getByRole("navigation", { name: appCopy.shell.tabsLabel }).waitFor();
  await page.goto(`/visits/${client.firstFit.id}`);
  await page.getByRole("link", { name: copy.page.reportVisit }).click();

  // The visit it came from is chosen; the category and the words are the client's.
  await expect(page.getByRole("heading", { level: 1, name: appCopy.titles.raise })).toBeVisible();
  const send = page.getByRole("button", { name: copy.raise.send });
  await expect(send).toBeDisabled();
  await expect(page.getByRole("radio", { name: new RegExp(fullDate(client.firstFit.date)) })).toBeChecked();
  await page.getByRole("radio", { name: appCopy.ISSUE_CATEGORIES.edges_lifting }).click();
  await page.getByRole("textbox", { name: copy.raise.what }).fill("The front lifts after the gym.");
  expect(await axeViolations(page)).toEqual([]);
  await send.click();

  // Its own page, named by its reference, with the client's words first in its log and Care still to answer.
  await expect(page).toHaveURL(/\/visits\/issues\/MM-ISS-\d{4}$/);
  await expect(page.getByRole("heading", { level: 1, name: appCopy.ISSUE_CATEGORIES.edges_lifting })).toBeVisible();
  await expect(page.getByText("The front lifts after the gym.")).toBeVisible();
  await expect(page.getByText(copy.page.waiting)).toBeVisible();
  await expect(page.getByRole("link", { name: copy.page.theVisit })).toHaveAttribute(
    "href",
    `/visits/${client.firstFit.id}`,
  );

  await page.getByRole("textbox", { name: copy.page.update }).fill("It is worse at the left temple now.");
  await page.getByRole("button", { name: copy.page.send }).click();
  await expect(page.getByText("It is worse at the left temple now.")).toBeVisible();

  await page.getByRole("button", { name: copy.page.sorted }).click();
  await expect(page.getByText(copy.page.resolved)).toBeVisible();
  await expect(page.getByRole("button", { name: copy.page.again })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  // Visits lists it under Issues, resolved.
  const issue = page.url();
  await page.goto("/visits/issues");
  const row = page.getByRole("link", { name: new RegExp(appCopy.ISSUE_CATEGORIES.edges_lifting) });
  await expect(row).toContainText(copy.states.resolved);

  // Happening again, it is reopened with what is happening now, and open once more.
  await page.goto(issue);
  await page.getByRole("button", { name: copy.page.again }).click();
  await page.getByRole("textbox", { name: copy.page.againLabel }).fill("It lifts again at the front.");
  await page.getByRole("button", { name: copy.page.reopen }).click();
  await expect(page.getByText("It lifts again at the front.")).toBeVisible();
  await expect(page.getByRole("button", { name: copy.page.sorted })).toBeVisible();
});

const PHOTO = { name: "front.jpg", mimeType: "image/jpeg", buffer: readFileSync("design/assets/ba-after.jpg") };

// A report sent again because its answer never came was filed twice; after one was filed, the same words were not.
test("sends a report again under its own key where its answer never came, and the next report under a new one", async ({
  page,
}) => {
  await logIn(page, fittedClient().mobile);
  await page.getByRole("navigation", { name: appCopy.shell.tabsLabel }).waitFor();
  const keys: (string | null)[] = [];
  await page.route("**/api/me/problems", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    keys.push(await route.request().headerValue("idempotency-key"));
    // The first send's answer never comes; each after it is filed, as the API answers.
    if (keys.length === 1) return route.abort("failed");
    return route.fulfill({ status: 201, json: { state: "sent", reference: `MM-ISS-90${String(keys.length)}0` } });
  });
  const raise = async () => {
    await page.evaluate(() => {
      window.history.pushState(null, "", "/visits/issues/new");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await page.getByRole("radio", { name: appCopy.ISSUE_CATEGORIES.itching }).click();
    await page.getByRole("textbox", { name: copy.raise.what }).fill("It itches along the hairline.");
  };
  await raise();
  const send = page.getByRole("button", { name: copy.raise.send });
  await send.click();
  await expect(page.getByText(copy.raise.failed)).toBeVisible();
  await send.click();
  await expect(page).toHaveURL(/\/visits\/issues\/MM-ISS-9020$/);

  // The same words again, in the same visit to the app: a report of their own.
  await raise();
  await page.getByRole("button", { name: copy.raise.send }).click();
  await expect(page).toHaveURL(/\/visits\/issues\/MM-ISS-9030$/);
  expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[0]);
});

test("says on the issue's page that a photo didn't upload, until one is added there", async ({ page }) => {
  await logIn(page, fittedClient().mobile);
  await page.getByRole("navigation", { name: appCopy.shell.tabsLabel }).waitFor();
  await page.goto("/visits/issues/new");
  // Its own category, so the issue the test above raises is the only one of its kind in Visits.
  await page.getByRole("radio", { name: appCopy.ISSUE_CATEGORIES.shedding }).click();
  await page.getByRole("textbox", { name: copy.raise.what }).fill("Hairs come away when I brush.");
  await page.getByLabel(copy.raise.addPhotos).setInputFiles(PHOTO);
  // The photo is made small before it is kept with the report: Send waits for it.
  await expect(page.getByRole("button", { name: copy.raise.removePhoto(1) })).toBeVisible();
  await page.route("**/api/me/problems/*/photos", (route) =>
    route.fulfill({ status: 500, json: { error: { code: "internal_error", request_id: "e2e" } } }),
  );
  await page.getByRole("button", { name: copy.raise.send }).click();
  await expect(page).toHaveURL(/\/visits\/issues\/MM-ISS-\d{4}\?photos=failed$/);
  await expect(page.getByText(copy.raise.photoFailed)).toBeVisible();

  await page.unroute("**/api/me/problems/*/photos");
  await page.getByLabel(copy.page.addPhoto).setInputFiles(PHOTO);
  await expect(page.getByText(copy.page.photos(1))).toBeVisible();
  await expect(page.getByText(copy.raise.photoFailed)).toHaveCount(0);
  await expect(page).toHaveURL(/\/visits\/issues\/MM-ISS-\d{4}$/);
});
