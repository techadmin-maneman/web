// The home page and the chrome every page shares (docs/archive/feature-inventory.md, items 1–21).

import type { Page } from "@playwright/test";
import { expect, test, visit } from "./support.ts";
import * as siteCopy from "../site/src/content/site.ts";

const narrow = (width: number | undefined) => (width ?? 0) <= 760;

/** Every film the page asks for from here on, filled in as it asks. */
function filmsFetched(page: Page): string[] {
  const films: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith(".mp4")) films.push(request.url());
  });
  return films;
}

test.describe("header", () => {
  // On a phone the button's full words ran into the wordmark.
  test("shows the mark and wordmark, and the free consultation, at every width", async ({ page }) => {
    await page.goto("/");
    const header = page.locator("header");
    await expect(header.getByRole("link", { name: siteCopy.header.homeLabel })).toHaveAttribute("href", "/");
    const book = narrow(page.viewportSize()?.width) ? siteCopy.header.bookShort : siteCopy.header.book;
    await expect(header.getByRole("link", { name: book, exact: true })).toHaveAttribute("href", "/book");
    const brand = await header.getByRole("link", { name: siteCopy.header.homeLabel }).boundingBox();
    const button = await header.getByRole("link", { name: book, exact: true }).boundingBox();
    expect((brand?.x ?? 0) + (brand?.width ?? 0)).toBeLessThan(button?.x ?? 0);
  });

  // The built pages are book.html and r.html, whose addresses the rule never matched, so both offered themselves.
  test("offers no Book a consultation on the booking pages themselves", async ({ page }) => {
    for (const path of ["/book", "/r/RM4K7P"]) {
      await page.goto(path);
      await expect(page.locator("header").getByRole("link", { name: siteCopy.header.homeLabel })).toBeVisible();
      await expect(page.locator('header a[href="/book"]'), path).toHaveCount(0);
    }
  });

  test("hides the section links and the area tag below 760 px, with no menu button", async ({ page }) => {
    await page.goto("/");
    const links = page.locator("header").getByRole("link", { name: siteCopy.range.title });
    if (narrow(page.viewportSize()?.width)) {
      await expect(links).toBeHidden();
      await expect(page.locator("header").getByText(siteCopy.header.area)).toBeHidden();
    } else {
      await expect(links).toBeVisible();
      await expect(page.locator("header").getByText(siteCopy.header.area)).toBeVisible();
    }
    await expect(page.locator("header").getByRole("button")).toHaveCount(0);
  });

  test("scrolls a section link to its section, 56 px below the top", async ({ page }) => {
    test.skip(narrow(page.viewportSize()?.width), "the links are hidden below 760 px");
    await page.goto("/");
    await page.locator("header").getByRole("link", { name: siteCopy.range.title }).click();
    await expect
      .poll(() => page.evaluate(() => Math.round(document.getElementById("range")?.getBoundingClientRect().top ?? 0)))
      .toBe(56);
  });

  test("goes home first from another page, then to the section", async ({ page }) => {
    test.skip(narrow(page.viewportSize()?.width), "the links are hidden below 760 px");
    await page.goto("/book");
    await page.locator("header").getByRole("link", { name: siteCopy.faq.title }).click();
    await expect(page).toHaveURL(/\/#faq$/);
    await expect
      .poll(() => page.evaluate(() => Math.round(document.getElementById("faq")?.getBoundingClientRect().top ?? 0)))
      .toBe(56);
  });
});

test.describe("sticky bar and footer: the home page only", () => {
  // The bar is a phone's: on a wider screen the header's own button books.
  test("appear on the home page, the bar on a phone only", async ({ page }, testInfo) => {
    await page.goto("/");
    const bar = page.getByRole("link", { name: siteCopy.stickyBar.whatsappLabel });
    if (testInfo.project.name === "390") await expect(bar).toBeVisible();
    else await expect(bar).toBeHidden();
    await expect(page.locator("footer")).toBeVisible();
    await expect(page.locator("footer")).toContainText(siteCopy.footer.entity);
    await expect(page.locator("footer")).toContainText(siteCopy.footer.area);
    await expect(page.locator("footer").getByRole("link", { name: siteCopy.faq.title, exact: true })).toHaveAttribute(
      "href",
      "/#faq",
    );
    await expect(page.locator('footer a[href="/book"]')).toHaveCount(1);
  });

  // Elsewhere the foot is slim: the pages, then the company, its privacy notice and its terms.
  for (const path of ["/try", "/book", "/privacy"]) {
    test(`are absent from ${path}, which keeps the slim foot`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("link", { name: siteCopy.stickyBar.whatsappLabel })).toHaveCount(0);
      await expect(page.locator("footer")).toHaveCount(1);
      await expect(page.locator("footer")).not.toContainText(siteCopy.footer.area);
      await expect(page.locator("footer")).toContainText(siteCopy.footer.entity);
      await expect(page.locator('footer a[href="/terms"]')).toHaveCount(1);
    });
  }

  // On a phone the header's links hide, and away from the home page nothing led anywhere but the home page and /book.
  test("the slim foot leads to the other pages, from a phone too", async ({ page }) => {
    await page.goto("/privacy");
    const pages = page.getByRole("navigation", { name: siteCopy.footer.pagesLabel });
    for (const link of siteCopy.footer.pages) {
      await expect(pages.getByRole("link", { name: link.label, exact: true })).toHaveAttribute("href", link.href);
    }
    await pages.getByRole("link", { name: siteCopy.tryOnTeaser.eyebrow, exact: true }).click();
    await expect(page).toHaveURL(/\/try$/);
  });
});

test.describe("skip link", () => {
  test("is the first stop, out of sight until focused, and moves the focus past the header", async ({ page }) => {
    await page.goto("/privacy");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: siteCopy.header.skip });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.querySelector("main")?.contains(document.activeElement))).toBe(true);
  });

  test("the hero keeps 72 px for the bar", async ({ page }) => {
    await page.goto("/");
    const padding = await page
      .locator('[data-section="hero"]')
      .evaluate((hero) => getComputedStyle(hero).paddingBottom);
    expect(padding).toBe("72px");
  });

  // The bar sat outside every landmark, and at 1440 its button ran 1,350 px across the screen.
  test("the bar is a landmark, and its button keeps to a phone’s width", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "390", "the bar is a phone's");
    await page.goto("/");
    const book = page
      .getByRole("navigation", { name: siteCopy.stickyBar.label })
      .getByRole("link", { name: siteCopy.header.book });
    await expect(book).toBeVisible();
    expect((await book.boundingBox())?.width ?? 0).toBeLessThanOrEqual(480);
  });
});

test.describe("WhatsApp", () => {
  test("every touchpoint opens wa.me with the business number", async ({ page }) => {
    await page.goto("/");
    const links = page.locator('a[href^="https://wa.me/"]');
    await expect(links).toHaveCount(3); // the sticky bar, the footer, the FAQ intro
    for (const href of await links.evaluateAll((all) => all.map((link) => link.getAttribute("href")))) {
      expect(href).toBe("https://wa.me/919034572990");
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
  // v2's order, the results beneath the hero, the technicians, materials and quotes gone (ADR 0213).
  test("are all there, in order", async ({ page }) => {
    await page.goto("/");
    const order = await page.locator("main > [data-section]").evaluateAll((all) => all.map((el) => el.dataset.section));
    expect(order).toEqual([
      "hero",
      "results",
      "what",
      "norwood",
      "comparison",
      "teaser",
      "discretion",
      "how",
      "range",
      "guarantee",
      "faq",
      "closing",
    ]);
  });

  test("hero calls to action go to /try and /book", async ({ page }) => {
    await page.goto("/");
    const hero = page.locator('[data-section="hero"]');
    await expect(hero.getByRole("link", { name: siteCopy.hero.tryOn })).toHaveAttribute("href", "/try");
    await expect(hero.getByRole("link", { name: siteCopy.hero.book })).toHaveAttribute("href", "/book");
  });

  test("the hero’s opening line is read whole, once, and turns one phrase at a time until paused", async ({ page }) => {
    await page.goto("/");
    const line = page.locator('[data-section="hero"] .sequence');
    await expect(line).toHaveText(
      "Natural up close. 100% real human hair. Fitted at home. Get your confident self back. Be the Main Man again.",
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteCopy.hero.title);
    const phrases = line.locator(".phrase");
    await expect(phrases.nth(0)).toHaveClass(/\bon\b/);
    // Long enough to read: still the first a second and a half in, then the second.
    await page.waitForTimeout(1_500);
    await expect(phrases.nth(0)).toHaveClass(/\bon\b/);
    await expect(phrases.nth(1)).toHaveClass(/\bon\b/, { timeout: 5_000 });
    await page.getByRole("button", { name: siteCopy.hero.pause }).click();
    const shown = await line.locator(".phrase.on").textContent();
    await page.waitForTimeout(3_500);
    await expect(line.locator(".phrase.on")).toHaveText(shown ?? "");
  });

  // Every phone downloaded the 2.3 MB film.
  test("the hero footage is muted, looped, inline, and the screen’s own cut once it plays", async ({ page }) => {
    await page.goto("/");
    const video = page.locator("[data-hero-video]");
    await expect(video).toHaveAttribute("preload", "none");
    await expect(video).toHaveAttribute("playsinline", "");
    await expect(video).toHaveAttribute("loop", "");
    expect(await video.evaluate((element: HTMLVideoElement) => element.muted)).toBe(true);
    const phone = (page.viewportSize()?.width ?? 0) <= 600;
    await expect(video).toHaveAttribute("src", phone ? /\/fit-film-phone\.[^/]+\.mp4$/ : /\/fit-film\.[^/]+\.mp4$/);
  });

  // Nothing on the home page is the design's material any more; the Norwood scale, made with an AI tool, says so.
  test("tags nothing as Placeholder, and the Norwood scale as an illustration", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(siteCopy.heroFootage.tag)).toHaveCount(0);
    await expect(page.locator(".label", { hasText: /^Placeholder$/ })).toHaveCount(0);
    await expect(
      page.locator('[data-section="norwood"] .label').getByText(siteCopy.illustrationTag, { exact: true }),
    ).toHaveCount(1);
  });

  // A strip of small pairs read poorly at both widths: one large pair at a time, on the compare, with its line.
  test("results: one pair at a time on the compare, its line, and the arrows to the rest", async ({ page }) => {
    await page.goto("/");
    const results = page.locator('[data-section="results"]');
    await expect(results.getByRole("heading", { level: 2 })).toHaveText(siteCopy.results.title);
    const [first, second, , last] = siteCopy.resultPairs.pairs;
    await expect(results.getByText(first?.caption ?? "")).toBeVisible();
    await expect(results.getByText("1 of 4")).toBeVisible();
    await expect(results.getByRole("slider", { name: siteCopy.results.sliderLabel })).toBeVisible();
    await expect(results.getByRole("img", { name: first?.after.alt ?? "" })).toBeVisible();

    // It hydrates once in view.
    await results.scrollIntoViewIfNeeded();
    await expect(results.locator("astro-island")).not.toHaveAttribute("ssr", "");
    await results.getByRole("button", { name: siteCopy.results.next }).click();
    await expect(results.getByText(second?.caption ?? "")).toBeVisible();
    await expect(results.getByText("2 of 4")).toBeVisible();

    // Round from the first to the last, the one made by AI, which says so.
    await results.getByRole("button", { name: siteCopy.results.previous }).click();
    await results.getByRole("button", { name: siteCopy.results.previous }).click();
    await expect(results.getByText(last?.caption ?? "")).toBeVisible();
    await expect(results.getByText(siteCopy.illustrationTag, { exact: true })).toBeVisible();
  });

  test("Norwood: the five stages we fit, a hairline restored, then Book a free consultation", async ({ page }) => {
    await page.goto("/");
    const norwood = page.locator('[data-section="norwood"]');
    await expect(norwood.locator(".cards > li")).toHaveCount(6);
    await expect(norwood.locator(".cards > li .name")).toHaveText([
      ...siteCopy.norwood.stages.map((stage) => stage.name),
      siteCopy.norwood.restored,
    ]);
    await expect(norwood.getByRole("link", { name: siteCopy.hero.book })).toHaveAttribute("href", "/book");
  });

  test("comparison: seven rows, ticks and crosses read as Yes and No", async ({ page }) => {
    test.skip(narrow(page.viewportSize()?.width), "a phone has the cards");
    await page.goto("/");
    const table = page.getByRole("table", { name: siteCopy.comparison.title });
    await expect(table.getByRole("row")).toHaveCount(8);
    // "Surgery" ticked the transplant, so at a glance surgery read as the plus.
    const surgery = table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "No surgery" }) });
    await expect(surgery.getByRole("cell")).toHaveText([
      siteCopy.comparison.no,
      siteCopy.comparison.yes,
      siteCopy.comparison.yes,
    ]);
    const effects = table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Side effects" }) });
    await expect(effects.getByRole("cell")).toHaveText([
      "Surgical risks",
      "Long-term side effects",
      "Nothing implanted or swallowed",
    ]);
  });

  // Three and four columns squeezed every cell onto four lines on a phone.
  test("comparison and range: a card for each option to swipe through on a phone, a table on a wider screen", async ({
    page,
  }) => {
    await page.goto("/");
    const phone = narrow(page.viewportSize()?.width);
    for (const [title, count] of [
      [siteCopy.comparison.title, 3],
      [siteCopy.range.title, 4],
    ] as const) {
      const cards = page.getByRole("list", { name: title });
      if (phone) {
        await expect(cards.getByRole("listitem")).toHaveCount(count);
        await expect(page.getByRole("table", { name: title })).toBeHidden();
      } else {
        await expect(cards).toBeHidden();
        await expect(page.getByRole("table", { name: title })).toBeVisible();
      }
    }
    if (!phone) return;
    const comparison = page.getByRole("list", { name: siteCopy.comparison.title }).getByRole("listitem");
    await expect(comparison.nth(0)).toContainText("Surgical risks");
    await expect(comparison.nth(2)).toContainText("Nothing implanted or swallowed");
    const celebrity = page.getByRole("list", { name: siteCopy.range.title }).getByRole("listitem").nth(3);
    await expect(celebrity).toContainText("Celebrity");
    await expect(celebrity).toContainText("Twice a month");
  });

  test("the teaser slider starts at 46% and moves with the keyboard", async ({ page }) => {
    await page.goto("/");
    const slider = page.getByRole("slider", { name: siteCopy.tryOnTeaser.sliderLabel });
    await slider.scrollIntoViewIfNeeded();
    await expect(slider).toHaveValue("46");
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveValue("47");
    await expect(page.getByRole("link", { name: siteCopy.tryOnTeaser.start })).toHaveAttribute("href", "/try");
  });

  // Nothing books a phone call, so no step promises one.
  test("how it works: three numbered steps, from the consultation at home", async ({ page }) => {
    await page.goto("/");
    const steps = page.locator('[data-section="how"] ol > li');
    await expect(steps).toHaveCount(3);
    await expect(steps.locator("h3")).toHaveText(["Consultation at home", "The first fit", "Regular service visits"]);
  });

  test("the range: the four side by side in a table, each row naming all four", async ({ page }) => {
    test.skip(narrow(page.viewportSize()?.width), "a phone has the cards");
    await page.goto("/");
    const table = page.getByRole("table", { name: siteCopy.range.title });
    // The corner's own header is the table's name.
    await expect(
      table.getByRole("columnheader").filter({ hasText: /^(?:Essential|Active|Natural|Celebrity)$/ }),
    ).toHaveText(["Essential", "Active", "Natural", "Celebrity"]);
    await expect(table.getByRole("row")).toHaveCount(siteCopy.range.rows.length + 1);
    const service = table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Service visit" }) });
    await expect(service.getByRole("cell")).toHaveText(["Monthly", "Monthly", "Monthly", "Twice a month"]);
  });

  // The site gives no prices (ADR 0103).
  test("gives no price of ours: no prices section, and nothing for the Worker to fill", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-section="prices"]')).toHaveCount(0);
    await expect(page.locator("[data-price]")).toHaveCount(0);
    await expect(page.locator('[data-section="comparison"]')).toContainText("Quoted free, before anything is fitted");
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
    await expect(closing).toContainText(siteCopy.closing.title);
    await expect(closing.getByRole("link", { name: siteCopy.hero.book })).toHaveAttribute("href", "/book");
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the hero’s opening line shows its last phrase alone, still", async ({ page }) => {
    await page.goto("/");
    const phrases = page.locator('[data-section="hero"] .phrase');
    await expect(phrases).toHaveCount(5);
    await expect(phrases.first()).toHaveCSS("opacity", "0");
    await expect(phrases.last()).toHaveCSS("opacity", "1");
    await page.waitForTimeout(3_500);
    await expect(phrases.last()).toHaveCSS("opacity", "1");
  });

  // A phone that never played the film still downloaded 1.4 MB of it.
  test("the hero footage stays paused, none of it is fetched, and scrolling is instant", async ({ page }) => {
    const films = filmsFetched(page);
    await page.goto("/");
    // The footage is started, if at all, by the page's load event: a frame after it, that has happened.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(await page.locator("[data-hero-video]").evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
    expect(films).toEqual([]);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("auto");
    // Paused already, so the control offers to play it.
    await expect(page.getByRole("button", { name: siteCopy.hero.play })).toBeVisible();
  });
});

test.describe("a visitor saving data", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "connection", {
        get: () => ({ saveData: true, effectiveType: "4g" }),
      });
    });
  });

  // The film cost a phone on prepaid data 2.3 MB before the visitor chose anything. The words cost nothing, so they
  // still turn, and Pause stops them.
  test("the hero footage waits for Play, and fetches nothing until then", async ({ page }) => {
    const films = filmsFetched(page);
    await page.goto("/");
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    const video = page.locator("[data-hero-video]");
    expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
    expect(films).toEqual([]);

    await page.getByRole("button", { name: siteCopy.hero.pause }).click();
    expect(films).toEqual([]);
    await page.getByRole("button", { name: siteCopy.hero.play }).click();
    await expect(page.getByRole("button", { name: siteCopy.hero.pause })).toBeVisible();
    await expect(video).toHaveAttribute("src", /\.mp4$/);
  });
});

test.describe("WCAG on the home page", () => {
  // Looping footage needs a way to stop it (WCAG 2.2.2).
  test("the hero footage can be paused, and stays paused", async ({ page }) => {
    await page.goto("/");
    const video = page.locator("[data-hero-video]");
    await page.getByRole("button", { name: siteCopy.hero.pause }).click();
    await expect(page.getByRole("button", { name: siteCopy.hero.play })).toBeVisible();
    expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  });

  // A link in its sentence's colour must look like a link (WCAG 1.4.1).
  test("the FAQ’s WhatsApp link is underlined", async ({ page }) => {
    await page.goto("/");
    const link = page.locator('[data-section="faq"]').getByRole("link", { name: siteCopy.faq.intro.link });
    expect(await link.evaluate((element) => getComputedStyle(element).textDecorationLine)).toBe("underline");
  });

  // The fixed header and the sticky bar never cover what the keyboard has reached (WCAG 2.4.11).
  test("a focused link is never under the header or the sticky bar", async ({ page }) => {
    await page.goto("/");
    const height = page.viewportSize()?.height ?? 0;
    // The sticky bar is a phone's: a wider screen keeps no room for it at the foot.
    const bar = narrow(page.viewportSize()?.width) ? 64 : 0;
    for (const name of ["Try-on", "Privacy", "Terms"]) {
      const link = page.locator("footer").getByRole("link", { name, exact: true });
      await link.focus();
      // The page scrolls smoothly; where the link comes to rest is what counts.
      const clear = async () => {
        const box = await link.boundingBox();
        return box !== null && box.y >= 56 && box.y + box.height <= height - bar;
      };
      await expect.poll(clear, { message: name }).toBe(true);
    }
  });

  // The page keeps its width on a 320 px phone, the results' strip scrolling within it.
  test("the page fits a 320 px screen", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
});

test.describe("other pages", () => {
  test("an unknown path gets the 404 page in the site layout", async ({ page }) => {
    const response = await page.goto("/no-such-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: siteCopy.notFound.title })).toBeVisible();
    await expect(page.locator("header")).toBeVisible();
  });

  // A heading per topic, and the number to ask for erasure is a link a phone can tap.
  test("privacy and terms carry their text under a heading per topic, with the number as a WhatsApp link", async ({
    page,
  }) => {
    await page.goto("/privacy");
    await expect(page.locator("article h2")).toHaveCount(6);
    await expect(page.getByRole("heading", { name: "Your rights" })).toBeVisible();
    // Twice: to withdraw an agreement, and to ask for erasure.
    const privacyLinks = page.locator("article a", { hasText: siteCopy.whatsapp.display });
    await expect(privacyLinks).toHaveCount(2);
    for (const link of await privacyLinks.all()) {
      await expect(link).toHaveAttribute("href", "https://wa.me/919034572990");
    }
    await expect(page.locator(".label", { hasText: siteCopy.placeholderTag })).toHaveCount(0);
    await page.goto("/terms");
    await expect(page.locator("article h2")).toHaveCount(8);
    await expect(page.getByText("the courts at New Delhi have jurisdiction", { exact: false })).toBeVisible();
    await expect(page.locator("article a", { hasText: siteCopy.whatsapp.display })).toHaveAttribute(
      "href",
      "https://wa.me/919034572990",
    );
    await expect(page.locator(".label", { hasText: siteCopy.placeholderTag })).toHaveCount(0);
  });

  // The footer gives the number as WhatsApp, not as a line to call.
  test("the footer gives the business number as WhatsApp, and no line to call", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: siteCopy.whatsapp.label })).toHaveAttribute(
      "href",
      "https://wa.me/919034572990",
    );
    await expect(page.locator('footer a[href^="tel:"]')).toHaveCount(0);
  });

  // A reminder or the launch alert could be stopped only from the app.
  test("/stop stops the messages its link names in one tap, and forgets the link", async ({ page }) => {
    const sent: unknown[] = [];
    await page.route("**/api/stop", (route) => {
      sent.push(route.request().postDataJSON());
      return route.fulfill({ json: { purpose: "whatsapp_launches" } });
    });
    await visit(page, "/stop#the-token");
    await page.getByRole("button", { name: siteCopy.stopMessages.ask.button }).click();

    await expect(page.getByRole("heading", { name: siteCopy.stopMessages.done.title })).toBeFocused();
    await expect(page.getByText(siteCopy.stopMessages.done.whatsapp_launches)).toBeVisible();
    expect(sent).toEqual([{ token: "the-token" }]);
    expect(new URL(page.url()).hash).toBe("");
  });

  test("/stop says a refused or missing link no longer works, and how else to stop", async ({ page }) => {
    await page.route("**/api/stop", (route) =>
      route.fulfill({ status: 404, json: { error: { code: "not_found", request_id: "r" } } }),
    );
    await visit(page, "/stop#forged");
    await page.getByRole("button", { name: siteCopy.stopMessages.ask.button }).click();
    await expect(page.getByRole("heading", { name: siteCopy.stopMessages.expired.title })).toBeVisible();

    await visit(page, "/stop");
    await expect(page.getByRole("heading", { name: siteCopy.stopMessages.expired.title })).toBeVisible();
    await expect(page.getByRole("link", { name: siteCopy.whatsapp.display })).toHaveAttribute(
      "href",
      "https://wa.me/919034572990",
    );
  });

  test("every page says it is mm-site, and is not indexed outside production", async ({ page }) => {
    for (const path of ["/", "/try", "/book", "/privacy", "/terms", "/stop"]) {
      await page.goto(path);
      await expect(page.locator('meta[name="mm-worker"]')).toHaveAttribute("content", "mm-site");
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
    }
  });
});
