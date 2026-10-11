// The guides and the cities page, as every build but production's draws them while their wording awaits the owner.

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
  // A draft says so, on every build but production's, which builds none.
  await expect(page.getByText("Placeholder", { exact: true })).toBeVisible();
  for (const section of first.sections)
    await expect(page.getByRole("heading", { level: 2, name: section.heading })).toBeVisible();
  await expect(page.getByRole("link", { name: guideCopy.guidesPage.book })).toHaveAttribute("href", "/book");
});

test("names each city we come to, and sends a visitor to check their pincode", async ({ page }) => {
  await page.goto("/areas");
  await expect(page.getByRole("heading", { level: 1, name: guideCopy.areasPage.title })).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveText([...guideCopy.areasPage.cities]);
  await expect(page.getByRole("link", { name: guideCopy.areasPage.check })).toHaveAttribute("href", "/book");
});
