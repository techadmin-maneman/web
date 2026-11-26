// The guides and the cities page, their wording approved.

import { expect, test } from "./support.ts";
import * as guideCopy from "../site/src/content/guides.ts";
import * as siteCopy from "../site/src/content/site.ts";

test("lists every guide, and each opens with its title, the way back and a way to book", async ({ page }) => {
  await page.goto("/guides");
  await expect(page.getByRole("heading", { level: 1, name: guideCopy.guidesPage.title })).toBeVisible();
  const [first] = guideCopy.guides;
  await expect(page.getByRole("link")).toContainText(guideCopy.guides.map((guide) => guide.title));
  if (first === undefined) return;

  await page.getByRole("link", { name: first.title }).click();
  await expect(page).toHaveURL(new RegExp(`/guides/${first.slug}$`));
  await expect(page.getByRole("heading", { level: 1, name: first.title })).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("link", { name: guideCopy.guidesPage.title, exact: true }),
  ).toHaveAttribute("href", "/guides");
  // Approved, so no draft tag.
  await expect(page.getByText(siteCopy.placeholderTag, { exact: true })).toHaveCount(0);
  for (const section of first.sections)
    await expect(page.getByRole("heading", { level: 2, name: section.heading })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: guideCopy.guidesPage.book })).toHaveAttribute(
    "href",
    "/book",
  );
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

// /areas was one page of five names, where a search for a hair system in a city found nothing of that city; then
// Gurgaon had two pages for one search, and its own had draft words (docs/decisions/0326-one-page-per-city.md).
test("each city has its full page, linked from /areas, its areas left for the Worker to list", async ({ page }) => {
  await page.goto("/areas");
  const city = "Gurgaon";
  const title = guideCopy.cityPage.title.replace("{city}", city);
  const cities = page.getByRole("navigation", { name: guideCopy.areasPage.cityPages });
  // Each row names its city, so the Worker leaves out one served nowhere (site/src/worker.ts, UnservedLeftOut).
  await expect(cities.locator("li:not([data-city])")).toHaveCount(0);
  await cities.getByRole("link", { name: title }).click();
  await expect(page).toHaveURL(/\/areas\/gurgaon$/);
  await expect(page).toHaveTitle(guideCopy.cityPage.pageTitle.replace("{city}", city));
  await expect(page.getByText(guideCopy.cityPage.area.replace("{city}", city), { exact: true })).toBeVisible();
  // Built hidden and empty: the Worker lists the areas served there, and shows them.
  const areas = page.locator(`[data-city-areas="${city}"]`);
  await expect(areas).toBeHidden();
  await expect(areas.locator(`ul[data-areas-of="${city}"]`)).toHaveCount(1);
  await expect(areas.locator('a[href="/book"]')).toHaveText(guideCopy.cityPage.check);
  // The footer's link names its city too, so the Worker leaves it out once the city is served nowhere.
  await expect(page.locator(`footer a[data-city="${city}"]`)).toHaveAttribute("href", "/areas/gurgaon");
  // The home page's questions, which are the page's FAQ for search engines too, and nothing tagged.
  await expect(page.locator("#faq summary")).toHaveText(siteCopy.faq.items.map((item) => item.q));
  const data = await structuredData(page);
  expect(data.map((block) => block["@type"])).toEqual(["Organization", "LocalBusiness", "FAQPage", "BreadcrumbList"]);
  await expect(page.getByText(siteCopy.placeholderTag, { exact: true })).toHaveCount(0);
});

test("gives a city with no footage of its own the home page's hero, naming it, and no clients' films", async ({
  page,
}) => {
  await page.goto("/areas/noida");
  await expect(page.getByText(guideCopy.cityPage.area.replace("{city}", "Noida"), { exact: true })).toBeVisible();
  await expect(page.locator("[data-hero-video]")).toHaveAttribute("data-phone-film", /fit-film-phone/);
  await expect(page.locator('[data-section="films"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: siteCopy.founderFilm.play, exact: true })).toHaveCount(1);
});

test("the home page names the company and the site, with the company’s mark", async ({ page }) => {
  await page.goto("/");
  const data = await structuredData(page);
  expect(data.map((block) => block["@type"])).toEqual(["Organization", "WebSite", "LocalBusiness", "FAQPage"]);
  expect(data[0]).toMatchObject({
    logo: "https://maneman.in/icon-512.png",
    sameAs: siteCopy.socialLinks.links.map((link) => link.href),
  });
});
