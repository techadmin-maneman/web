// The home page and the chrome every page shares (docs/feature-inventory.md, items 1–21).

import { expect, test } from "./support.ts";

const narrow = (width: number | undefined) => (width ?? 0) <= 760;

test.describe("header", () => {
  test("shows the mark and wordmark, and Book a visit, at every width", async ({ page }) => {
    await page.goto("/");
    const header = page.locator("header");
    await expect(header.getByRole("link", { name: "Mane Man, home" })).toHaveAttribute("href", "/");
    await expect(header.getByRole("link", { name: "Book a visit" })).toHaveAttribute("href", "/book");
  });

  test("hides the section links and the area tag below 760 px, with no menu button", async ({ page }) => {
    await page.goto("/");
    const links = page.locator("header").getByRole("link", { name: "Prices" });
    if (narrow(page.viewportSize()?.width)) {
      await expect(links).toBeHidden();
      await expect(page.locator("header").getByText("Delhi NCR")).toBeHidden();
    } else {
      await expect(links).toBeVisible();
      await expect(page.locator("header").getByText("Delhi NCR")).toBeVisible();
    }
    await expect(page.locator("header").getByRole("button")).toHaveCount(0);
  });

  test("scrolls a section link to its section, 56 px below the top", async ({ page }) => {
    test.skip(narrow(page.viewportSize()?.width), "the links are hidden below 760 px");
    await page.goto("/");
    await page.locator("header").getByRole("link", { name: "Prices" }).click();
    await expect
      .poll(() => page.evaluate(() => Math.round(document.getElementById("prices")?.getBoundingClientRect().top ?? 0)))
      .toBe(56);
  });

  test("goes home first from another page, then to the section", async ({ page }) => {
    test.skip(narrow(page.viewportSize()?.width), "the links are hidden below 760 px");
    await page.goto("/book");
    await page.locator("header").getByRole("link", { name: "Questions" }).click();
    await expect(page).toHaveURL(/\/#faq$/);
    await expect
      .poll(() => page.evaluate(() => Math.round(document.getElementById("faq")?.getBoundingClientRect().top ?? 0)))
      .toBe(56);
  });
});

test.describe("sticky bar and footer: the home page only", () => {
  test("appear on the home page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Message us on WhatsApp" })).toBeVisible();
    await expect(page.locator("footer")).toBeVisible();
    await expect(page.locator("footer")).toContainText("Mane Man Grooming Services Private Limited");
    await expect(page.locator("footer")).toContainText("Delhi NCR · home service only");
  });

  for (const path of ["/try", "/book", "/privacy"]) {
    test(`are absent from ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("link", { name: "Message us on WhatsApp" })).toHaveCount(0);
      await expect(page.locator("footer")).toHaveCount(0);
    });
  }

  test("the hero keeps 72 px for the bar", async ({ page }) => {
    await page.goto("/");
    const padding = await page
      .locator('[data-section="hero"]')
      .evaluate((hero) => getComputedStyle(hero).paddingBottom);
    expect(padding).toBe("72px");
  });
});

test.describe("WhatsApp", () => {
  test("every touchpoint opens wa.me with the business number", async ({ page }) => {
    await page.goto("/");
    const links = page.locator('a[href^="https://wa.me/"]');
    await expect(links).toHaveCount(3); // the sticky bar, the footer, the FAQ intro
    for (const href of await links.evaluateAll((all) => all.map((link) => link.getAttribute("href")))) {
      expect(href).toBe("https://wa.me/919007973247");
    }
  });
});

test.describe("hash routes from v2", () => {
  test("/#tryon goes to /try", async ({ page }) => {
    await page.goto("/#tryon");
    await expect(page).toHaveURL(/\/try$/);
  });

  test("/#book goes to /book", async ({ page }) => {
    await page.goto("/#book");
    await expect(page).toHaveURL(/\/book$/);
  });
});

test.describe("home sections", () => {
  test("are all there, in v2's order", async ({ page }) => {
    await page.goto("/");
    const order = await page.locator("main > [data-section]").evaluateAll((all) => all.map((el) => el.dataset.section));
    expect(order).toEqual([
      "hero",
      "what",
      "norwood",
      "comparison",
      "teaser",
      "discretion",
      "how",
      "technicians",
      "bases",
      "prices",
      "testimonials",
      "guarantee",
      "faq",
      "closing",
    ]);
  });

  test("hero calls to action go to /try and /book", async ({ page }) => {
    await page.goto("/");
    const hero = page.locator('[data-section="hero"]');
    await expect(hero.getByRole("link", { name: "See yourself with hair" })).toHaveAttribute("href", "/try");
    await expect(hero.getByRole("link", { name: "Book a free consultation" })).toHaveAttribute("href", "/book");
  });

  test("the hero footage is muted, looped, inline and fetches metadata only", async ({ page }) => {
    await page.goto("/");
    const video = page.locator("[data-hero-video]");
    await expect(video).toHaveAttribute("preload", "metadata");
    await expect(video).toHaveAttribute("playsinline", "");
    await expect(video).toHaveAttribute("loop", "");
    expect(await video.evaluate((element: HTMLVideoElement) => element.muted)).toBe(true);
  });

  test("shows the design's Placeholder tags outside production", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Placeholder footage")).toBeVisible();
    expect(await page.locator(".label", { hasText: /^Placeholder$/ }).count()).toBeGreaterThan(10);
  });

  test("Norwood: two early stages, five we fit, then Book a free consultation", async ({ page }) => {
    await page.goto("/");
    const norwood = page.locator('[data-section="norwood"]');
    await expect(norwood.locator(".early > li")).toHaveCount(2);
    await expect(norwood.locator(".flow > li")).toHaveCount(5);
    await expect(norwood.getByText("A system here would cover hair you still have.")).toBeVisible();
    await expect(norwood.getByRole("link", { name: "Book a free consultation" })).toHaveAttribute("href", "/book");
  });

  test("comparison: seven rows, ticks and crosses read as Yes and No", async ({ page }) => {
    await page.goto("/");
    const table = page.getByRole("table", { name: "Transplant, medication, or a system" });
    await expect(table.getByRole("row")).toHaveCount(8);
    await expect(table.getByRole("rowheader", { name: "Surgery" })).toHaveCount(1);
    const surgery = table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Surgery" }) });
    await expect(surgery.getByRole("cell")).toHaveText(["Yes", "No", "No"]);
  });

  test("comparison: below 760 px each label sits above its row, in three columns", async ({ page }) => {
    await page.goto("/");
    const above = page.locator('[data-section="comparison"] .label-above').first();
    if (narrow(page.viewportSize()?.width)) await expect(above).toBeVisible();
    else await expect(above).toBeHidden();
  });

  test("the teaser slider starts at 46% and moves with the keyboard", async ({ page }) => {
    await page.goto("/");
    const slider = page.getByRole("slider", { name: "Compare before and after" });
    await slider.scrollIntoViewIfNeeded();
    await expect(slider).toHaveValue("46");
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveValue("47");
    await expect(page.getByRole("link", { name: "Start the try-on" })).toHaveAttribute("href", "/try");
  });

  test("how it works: four numbered steps", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-section="how"] ol > li')).toHaveCount(4);
  });

  test("technicians, bases and testimonials: three, two and three cards", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-section="technicians"] li')).toHaveCount(3);
    await expect(page.locator('[data-section="bases"] article')).toHaveCount(2);
    await expect(page.locator('[data-section="testimonials"] li')).toHaveCount(3);
  });

  test("prices: the three-row table, and both calls to action", async ({ page }) => {
    await page.goto("/");
    const table = page.getByRole("table", { name: "Published prices" });
    await expect(table.getByRole("row")).toHaveCount(4);
    const prices = page.locator('[data-section="prices"]');
    // FEO-22: the price book's figures, as the page is built, and the first year computed from them. Behind
    // Cloudflare mm-site's Worker writes the book's figures of the day over these (site/src/worker.ts).
    await expect(table.getByRole("row", { name: /^First fit/ }).getByRole("cell")).toHaveText(["₹30,000", "₹40,000"]);
    await expect(prices.getByText("A standard base in the first year: ₹30,000", { exact: false })).toHaveText(
      "A standard base in the first year: ₹30,000 plus twelve service visits at ₹2,000 — ₹54,000.",
    );
    await expect(prices.getByRole("link", { name: "Book a free consultation" })).toHaveAttribute("href", "/book");
    await expect(prices.getByRole("link", { name: "Or see yourself with hair first" })).toHaveAttribute("href", "/try");
  });

  test("FAQ: ten questions, the first open, one open at a time", async ({ page }) => {
    await page.goto("/");
    const items = page.locator('[data-section="faq"] details');
    await expect(items).toHaveCount(10);
    await expect(items.nth(0)).toHaveAttribute("open", "");
    await items.nth(3).locator("summary").click();
    await expect(items.nth(3)).toHaveAttribute("open", "");
    await expect(items.nth(0)).not.toHaveAttribute("open", "");
  });

  test("the closing band books a free consultation", async ({ page }) => {
    await page.goto("/");
    const closing = page.locator('[data-section="closing"]');
    await expect(closing).toContainText("The consultation takes an hour and costs nothing.");
    await expect(closing.getByRole("link", { name: "Book a free consultation" })).toHaveAttribute("href", "/book");
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the hero footage stays paused and scrolling is instant", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(500);
    expect(await page.locator("[data-hero-video]").evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("auto");
    // Paused already, so the control offers to play it.
    await expect(page.getByRole("button", { name: "Play the film" })).toBeVisible();
  });
});

test.describe("WCAG on the home page", () => {
  // A11Y-10: looping footage needs a way to stop it (WCAG 2.2.2).
  test("the hero footage can be paused, and stays paused", async ({ page }) => {
    await page.goto("/");
    const video = page.locator("[data-hero-video]");
    await page.getByRole("button", { name: "Pause the film" }).click();
    await expect(page.getByRole("button", { name: "Play the film" })).toBeVisible();
    expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  });

  // A11Y-02: a link in its sentence's colour must look like a link (WCAG 1.4.1).
  test("the FAQ's WhatsApp link is underlined", async ({ page }) => {
    await page.goto("/");
    const link = page.locator('[data-section="faq"]').getByRole("link", { name: "ask on WhatsApp" });
    expect(await link.evaluate((element) => getComputedStyle(element).textDecorationLine)).toBe("underline");
  });

  // A11Y-09: the fixed header and the sticky bar never cover what the keyboard has reached (WCAG 2.4.11).
  test("a focused link is never under the header or the sticky bar", async ({ page }) => {
    await page.goto("/");
    const height = page.viewportSize()?.height ?? 0;
    for (const name of ["Try-on", "Privacy", "Terms"]) {
      const link = page.locator("footer").getByRole("link", { name, exact: true });
      await link.focus();
      // The page scrolls smoothly; where the link comes to rest is what counts.
      const clear = async () => {
        const box = await link.boundingBox();
        return box !== null && box.y >= 56 && box.y + box.height <= height - 64;
      };
      await expect.poll(clear, { message: name }).toBe(true);
    }
  });

  // VIS-10, A11Y-03: the prices keep their columns, and the page its width, on a 320 px phone.
  test("the prices table fits a 320 px screen, its columns in line", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const lefts = await page
      .locator('[data-section="prices"] [role="row"] > :nth-child(2)')
      .evaluateAll((cells) => cells.map((cell) => Math.round(cell.getBoundingClientRect().left)));
    expect(new Set(lefts).size).toBe(1);
  });
});

test.describe("other pages", () => {
  test("an unknown path gets the 404 page in the site layout", async ({ page }) => {
    const response = await page.goto("/no-such-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "This page is not here." })).toBeVisible();
    await expect(page.locator("header")).toBeVisible();
  });

  test("privacy and terms carry their text, with no placeholder tag", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.locator("article p")).toHaveCount(2);
    await expect(page.locator(".label", { hasText: "Placeholder" })).toHaveCount(0);
    await page.goto("/terms");
    await expect(page.locator("article p")).toHaveCount(5);
    await expect(page.getByText("the courts at New Delhi have jurisdiction", { exact: false })).toBeVisible();
    await expect(page.locator(".label", { hasText: "Placeholder" })).toHaveCount(0);
  });

  test("the footer's phone number is the business line", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Phone · +91 90079 73247" })).toHaveAttribute(
      "href",
      "tel:+919007973247",
    );
  });

  test("every page says it is mm-site, and is not indexed outside production", async ({ page }) => {
    for (const path of ["/", "/try", "/book", "/privacy", "/terms"]) {
      await page.goto(path);
      await expect(page.locator('meta[name="mm-worker"]')).toHaveAttribute("content", "mm-site");
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
    }
  });
});
