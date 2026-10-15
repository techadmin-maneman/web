// The guides and the cities page, their wording approved.

import { expect, test } from "./support.ts";
import * as guideCopy from "../site/src/content/guides.ts";
import { placeholderTag } from "../site/src/content/site.ts";

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
  await expect(page.getByText(placeholderTag, { exact: true })).toHaveCount(0);
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

/** The page's structured data, each block parsed. */
async function structuredData(page: import("@playwright/test").Page): Promise<Record<string, unknown>[]> {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.map((block) => JSON.parse(block) as Record<string, unknown>);
}

// A guide was a title and sections with one button: no article, no date, no author, and no way to another guide.
test("a guide tells search engines it is an article, dated, by the company, with the way back home", async ({
  page,
}) => {
  const [first, second] = guideCopy.guides;
  if (first === undefined || second === undefined) return;
  await page.goto(`/guides/${first.slug}`);
  const data = await structuredData(page);
  expect(data.find((block) => block["@type"] === "Article")).toMatchObject({
    headline: first.title,
    datePublished: first.published,
    dateModified: first.updated,
    author: { "@type": "Organization", name: "Mane Man" },
  });
  const trail = data.find((block) => block["@type"] === "BreadcrumbList");
  expect(trail?.itemListElement).toHaveLength(3);
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute("content", "article");
  await expect(page).toHaveTitle(`${first.title} — Mane Man`);

  const related = page.getByRole("navigation", { name: guideCopy.guidesPage.related });
  await expect(related.getByRole("link", { name: second.title })).toHaveAttribute("href", `/guides/${second.slug}`);
  await expect(related.getByRole("link", { name: guideCopy.guidesPage.tryOn })).toHaveAttribute("href", "/try");
  await expect(related.getByRole("link", { name: guideCopy.guidesPage.questions })).toHaveAttribute("href", "/#faq");
});

// /areas was one page of five names, where a search for a hair system in a city found nothing of that city.
test("each city has a page of its own, linked from /areas, its areas left for the Worker to list", async ({ page }) => {
  await page.goto("/areas");
  const city = "Gurgaon";
  const title = guideCopy.cityPage.title.replace("{city}", city);
  await page
    .getByRole("navigation", { name: guideCopy.areasPage.cityPages })
    .getByRole("link", { name: title })
    .click();
  await expect(page).toHaveURL(/\/areas\/gurgaon$/);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.locator("[data-city-areas]")).toBeHidden();
  await expect(page.getByRole("link", { name: guideCopy.cityPage.check })).toHaveAttribute("href", "/book");
  await expect(
    page.getByRole("navigation", { name: guideCopy.cityPage.others }).getByRole("link", { name: /Hair systems in/ }),
  ).toHaveCount(4);
});

test("the home page names the company and the site, with the company’s mark", async ({ page }) => {
  await page.goto("/");
  const data = await structuredData(page);
  expect(data.map((block) => block["@type"])).toEqual(["Organization", "WebSite", "LocalBusiness", "FAQPage"]);
  expect(data[0]).toMatchObject({ logo: "https://maneman.in/icon-512.png" });
});
