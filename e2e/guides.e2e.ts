// The guides and the cities page, their wording approved.

import { expect, test } from "./support.ts";
import * as guideCopy from "../site/src/content/guides.ts";

test("lists every guide, and each opens with its title and a way to book", async ({ page }) => {
  await page.goto("/guides");
  await expect(page.getByRole("heading", { level: 1, name: guideCopy.guidesPage.title })).toBeVisible();
  const [first] = guideCopy.guides;
  await expect(page.getByRole("link")).toContainText(guideCopy.guides.map((guide) => guide.title));
  if (first === undefined) return;

  await page.getByRole("link", { name: first.title }).click();
  await expect(page).toHaveURL(new RegExp(`/guides/${first.slug}$`));
  await expect(page.getByRole("heading", { level: 1, name: first.title })).toBeVisible();
  // Approved, so no draft tag.
  await expect(page.getByText("Placeholder", { exact: true })).toHaveCount(0);
  for (const section of first.sections)
    await expect(page.getByRole("heading", { level: 2, name: section.heading })).toBeVisible();
  await expect(page.getByRole("link", { name: guideCopy.guidesPage.book })).toHaveAttribute("href", "/book");
});

// As built it names no city; the site's Worker writes in those ops serve (test/worker/site/site-worker-cities.test.ts).
test("says where we come, ready for the cities served, and sends a visitor to check their pincode", async ({
  page,
}) => {
  await page.goto("/areas");
  await expect(page.getByRole("heading", { level: 1, name: guideCopy.areasPage.title })).toBeVisible();
  const lead = page.getByText(guideCopy.areasPage.lead);
  await expect(lead).toHaveAttribute("data-cities", guideCopy.areasPage.cities);
  await expect(page.getByRole("link", { name: guideCopy.areasPage.check })).toHaveAttribute("href", "/book");
});
