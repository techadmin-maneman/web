// The try-on's screens, opened directly with ?state= (docs/archive/feature-inventory.md,
// items 22–30). These make no API calls; try-flow.e2e.ts runs the flow on a
// mocked API, and try-api.e2e.ts on the local one. The look goes to WhatsApp
// only (ADR 0104): there is no processing or result screen, and the gate comes
// before the look is made.

import type { Page } from "@playwright/test";
import { drawnHeadPhoto, expect, fakeTurnstile, test, TINY_JPEG } from "./support.ts";

test.beforeEach(async ({ page }) => {
  await fakeTurnstile(page);
});

const SCREENS = {
  upload: { label: "Step one of four", progress: 14 },
  consent: { label: "Before we begin", progress: 28 },
  stage: { label: "Step two of four", progress: 44 },
  looks: { label: "Step three of four", progress: 60 },
  gate: { label: "Step four of four", progress: 90 },
  sent: { label: "Sent to WhatsApp", progress: 100 },
  error: { label: "Cannot use this photograph", progress: 28 },
} as const;
type Screen = keyof typeof SCREENS;

async function open(page: Page, screen: Screen): Promise<void> {
  await page.goto(screen === "upload" ? "/try" : `/try?state=${screen}`);
  // Astro drops [ssr] from an island once it has hydrated.
  await page.waitForFunction(() => document.querySelectorAll("astro-island[ssr]").length === 0);
  await expect(page.locator("[data-screen]")).toHaveAttribute("data-screen", screen);
}

/** The progress bar's width as a whole percentage of its track. */
function progress(page: Page): Promise<number> {
  return page
    .locator("[data-screen] > div")
    .first()
    .evaluate((track) => {
      const bar = track.firstElementChild as HTMLElement;
      return Math.round((bar.getBoundingClientRect().width / track.getBoundingClientRect().width) * 100);
    });
}

test.describe("chrome", () => {
  for (const [screen, expected] of Object.entries(SCREENS) as [Screen, (typeof SCREENS)[Screen]][]) {
    test(`${screen}: "${expected.label}" and ${String(expected.progress)}% progress`, async ({ page }) => {
      await open(page, screen);
      await expect(page.getByText(expected.label, { exact: true })).toBeVisible();
      await expect.poll(() => progress(page)).toBe(expected.progress);
    });
  }

  const BACK: [Screen, Screen][] = [
    ["consent", "upload"],
    ["stage", "consent"],
    ["looks", "stage"],
    ["gate", "looks"],
    ["error", "upload"],
  ];
  for (const [from, to] of BACK) {
    test(`back from ${from} goes to ${to}`, async ({ page }) => {
      await open(page, from);
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(page.locator("[data-screen]")).toHaveAttribute("data-screen", to);
    });
  }

  for (const screen of ["upload", "sent"] as const) {
    test(`back from the ${screen} screen returns to the site`, async ({ page }) => {
      await open(page, screen);
      await page.getByRole("button", { name: "Back to the site" }).click();
      await expect(page).toHaveURL(/\/$/);
    });
  }
});

test.describe("upload", () => {
  test("three guidelines, two ways in, and no demo link to the error screen", async ({ page }) => {
    await open(page, "upload");
    await expect(page.locator("[data-screen] ol > li")).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Choose a photograph" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Use the camera" })).toBeVisible();
    await expect(page.getByText("See what happens if the photo will not work")).toHaveCount(0);
    await expect(page.locator('input[type="file"][capture="user"]')).toHaveCount(1);
  });

  // UX-39: on a phone the caption sat across the oval's lower corner brackets.
  test("the frame's caption sits below the oval and its brackets", async ({ page }) => {
    await open(page, "upload");
    const oval = await page.locator('svg:has(use[href="#oval"])').boundingBox();
    const caption = await page.getByText("Your photograph appears here").boundingBox();
    expect(caption?.y ?? 0).toBeGreaterThanOrEqual((oval?.y ?? 0) + (oval?.height ?? 0));
  });

  test("a chosen photograph shows in the frame and the consent screen follows", async ({ page }) => {
    await open(page, "upload");
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles(await drawnHeadPhoto());
    await expect(page.locator("[data-screen]")).toHaveAttribute("data-screen", "consent");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("img", { name: "The photograph you chose" })).toBeVisible();
  });

  test("a photograph too small for the API is refused before anything is sent", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (request) => {
      // On arrival the page asks whether this browser has had its look, and whether the try-on runs (CLI-29); the
      // photograph never leaves.
      const arrival = ["/api/tryon/look", "/api/tryon/availability"].some((path) => request.url().endsWith(path));
      if (request.url().includes("/api/tryon/") && !arrival) calls.push(request.url());
    });
    await open(page, "upload");
    await page.locator('input[type="file"]').first().setInputFiles(TINY_JPEG);
    await expect(page.locator("[data-screen]")).toHaveAttribute("data-screen", "error");
    await expect(page.getByRole("heading", { name: "We cannot use this photograph." })).toBeVisible();
    expect(calls).toEqual([]);
  });
});

test.describe("consent", () => {
  test("five rows, and Continue does nothing until the box is ticked", async ({ page }) => {
    await open(page, "consent");
    await expect(page.locator("[data-screen] dl > div")).toHaveCount(5);
    const next = page.getByRole("button", { name: "Continue" });
    await expect(next).toHaveAttribute("aria-disabled", "true");
    await next.click({ force: true }); // it stays focusable and clickable, but does nothing
    await expect(page.locator("[data-screen]")).toHaveAttribute("data-screen", "consent");
    await page.getByText("I understand, and I agree to my photograph being used this way.").click();
    await expect(next).toHaveAttribute("aria-disabled", "false");
    await next.click();
    await expect(page.locator("[data-screen]")).toHaveAttribute("data-screen", "stage");
  });

  // CP-07: /try has no footer, so the line names none.
  test("the words privacy notice link to /privacy, and nothing else is added", async ({ page }) => {
    await open(page, "consent");
    await expect(page.getByRole("link", { name: "privacy notice" })).toHaveAttribute("href", "/privacy");
    await expect(page.getByText("Read the full privacy notice.")).toBeVisible();
    await expect(page.getByText("footer", { exact: false })).toHaveCount(0);
  });
});

test.describe("stage and looks", () => {
  test("three stages, the first chosen", async ({ page }) => {
    await open(page, "stage");
    const stages = page.getByRole("radio");
    await expect(stages).toHaveCount(3);
    await expect(stages.first()).toBeChecked();
  });

  test("six looks; the button changes once one is picked, and goes on to the gate", async ({ page }) => {
    await open(page, "looks");
    await expect(page.getByRole("radio")).toHaveCount(6);
    // UX-22: until all six looks have a picture, no empty box stands in for one.
    await expect(page.getByText("Preview", { exact: true })).toHaveCount(0);
    await expect(page.locator("[data-screen] fieldset img")).toHaveCount(0);
    const next = page.getByRole("button", { name: "Choose one to continue" });
    await expect(next).toHaveAttribute("aria-disabled", "true");
    await page.getByText("Light density").first().click();
    const onward = page.getByRole("button", { name: "Continue" });
    await expect(onward).toHaveAttribute("aria-disabled", "false");
    await onward.click();
    await expect(page.locator("[data-screen]")).toHaveAttribute("data-screen", "gate");
  });
});

test.describe("gate", () => {
  // ADR 0104: the look is sent to the number, so the gate needs it, and says so.
  test("asks where to send the look before it is made, and needs both fields", async ({ page }) => {
    await open(page, "gate");
    await expect(page.getByText("We make your simulation once we have your number", { exact: false })).toBeVisible();
    await expect(page.getByText("never shown on this site", { exact: false })).toBeVisible();
    await expect(page.getByLabel("Name")).toHaveAttribute("aria-required", "true");
    await expect(page.getByLabel("Mobile")).toHaveAttribute("aria-required", "true");
    await page.getByRole("button", { name: "Send my look" }).click();
    await expect(page.getByText("Tell us what to call you, in letters.")).toBeVisible();
    await expect(page.getByText("Enter a valid 10-digit mobile number.")).toBeVisible();
    await expect(page.getByLabel("Name")).toBeFocused();
    await expect(page.locator("[data-screen]")).toHaveAttribute("data-screen", "gate");
  });

  // BK-28: a number starting with 5 is not a mobile, and the gate says so at the field.
  test("a gate half filled in says what is missing, focused, then sends the look", async ({ page }) => {
    await open(page, "gate");
    await page.getByLabel("Mobile").fill("98100");
    await page.getByRole("button", { name: "Send my look" }).click();
    await expect(page.getByText("Tell us what to call you, in letters.")).toBeVisible();
    await expect(page.getByLabel("Name")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Name")).toBeFocused();
    await page.getByLabel("Name").fill("Test Visitor");
    await page.getByLabel("Mobile").fill("5876543210");
    await page.getByRole("button", { name: "Send my look" }).click();
    await expect(page.getByLabel("Mobile")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Mobile")).toHaveAccessibleDescription("Enter a valid 10-digit mobile number.");
    await expect(page.getByLabel("Mobile")).toBeFocused();
    await page.getByLabel("Mobile").fill("9810000000");
    await expect(page.getByLabel("Mobile")).toHaveValue("98100 00000");
    await page.getByRole("button", { name: "Send my look" }).click();
    await expect(page.locator("[data-screen]")).toHaveAttribute("data-screen", "sent");
  });

  test("the image column sits below the form under 760 px, beside it above", async ({ page }) => {
    await open(page, "gate");
    const form = await page.locator("form").boundingBox();
    const image = await page.getByText("Your simulation is sent to your WhatsApp", { exact: false }).boundingBox();
    if ((page.viewportSize()?.width ?? 0) <= 760) expect(image?.y).toBeGreaterThan(form?.y ?? 0);
    else expect(image?.x ?? 0).toBeLessThan(form?.x ?? 0);
  });

  // UX-39: on a phone an empty frame sat under the form, its label across the gilt divider.
  test("hides the empty frame under 600 px, and keeps its label inside its half above", async ({ page }) => {
    await open(page, "gate");
    const label = page.getByText("For your WhatsApp only");
    if ((page.viewportSize()?.width ?? 0) <= 600) {
      await expect(label).toBeHidden();
      return;
    }
    const frame = await label.locator("..").boundingBox();
    const box = await label.boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual((frame?.x ?? 0) + (frame?.width ?? 0) / 2);
  });
});

test.describe("sent", () => {
  // ADR 0104: the look is on its way to WhatsApp, and never on the site.
  test("says the look is on its way to the number given, shows no look, and offers two ways on", async ({ page }) => {
    await open(page, "sent");
    await expect(page.getByRole("heading", { name: "Your new look is on its way." })).toBeVisible();
    await expect(
      page.getByText("It'll reach WhatsApp on +91 98100 00000 within minutes. We delete it after 14 days."),
    ).toBeVisible();
    await expect(page.getByText("never shown on this site", { exact: false })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Book a free consultation" })).toHaveAttribute("href", "/book");
    await expect(page.getByRole("link", { name: "Back to the site" })).toHaveAttribute("href", "/");
    await expect(page.locator("[data-screen] img")).toHaveCount(0);
    await expect(page.getByRole("slider")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Download" })).toHaveCount(0);
  });

  test("tells a returning visitor their look was sent, without a number or the look", async ({ page }) => {
    await page.goto("/try?state=sent&kind=returning");
    await expect(page.getByRole("heading", { name: "Your look has already been sent." })).toBeVisible();
    await expect(page.getByText("We sent it to the WhatsApp number you gave.", { exact: false })).toBeVisible();
    await expect(page.getByText("+91", { exact: false })).toHaveCount(0);
    await expect(page.locator("[data-screen] img")).toHaveCount(0);
  });
});

test.describe("error", () => {
  test("Choose another returns to the upload; Book a visit instead goes to /book", async ({ page }) => {
    await open(page, "error");
    await expect(page.getByRole("heading", { name: "We cannot use this photograph." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Book a visit instead" })).toHaveAttribute("href", "/book");
    await page.getByRole("button", { name: "Choose another" }).click();
    await expect(page.locator("[data-screen]")).toHaveAttribute("data-screen", "upload");
  });

  const KINDS = [
    {
      kind: "renderFailed",
      step: "Something went wrong",
      frame: "The simulation failed",
      heading: "The simulation did not work this time.",
      another: true,
    },
    {
      kind: "busy",
      step: "Please try again shortly",
      frame: "The simulation is busy",
      heading: "The simulation is busy just now.",
      another: true,
    },
    {
      kind: "unavailable",
      step: "Not available right now",
      frame: "Paused",
      heading: "The try-on is paused.",
      another: false,
    },
  ];
  for (const { kind, step, frame, heading, another } of KINDS) {
    test(`${kind} has its own labels, heading and body, and never blames the photograph`, async ({ page }) => {
      await page.goto(`/try?state=error&kind=${kind}`);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await expect(page.getByText(step, { exact: true })).toBeVisible();
      await expect(page.getByText(frame, { exact: true })).toBeVisible();
      await expect(page.getByText("photograph", { exact: false }).filter({ hasText: /Cannot/ })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Book a visit instead" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Choose another" })).toHaveCount(another ? 1 : 0);
    });
  }
});
