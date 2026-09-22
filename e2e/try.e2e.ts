// The try-on's screens, opened directly with ?state= (docs/feature-inventory.md,
// items 22–30). These make no API calls; try-flow.e2e.ts runs the flow on a
// mocked API, and try-api.e2e.ts on the local one.

import type { Page } from "@playwright/test";
import { drawnHeadPhoto, expect, fakeTurnstile, test, TINY_JPEG } from "./support.ts";

test.beforeEach(async ({ page }) => {
  await fakeTurnstile(page);
});

const SCREENS = {
  upload: { label: "Step one of five", progress: 14 },
  consent: { label: "Before we begin", progress: 28 },
  stage: { label: "Step two of five", progress: 44 },
  looks: { label: "Step three of five", progress: 60 },
  processing: { label: "Step four of five", progress: 78 },
  gate: { label: "Step five of five", progress: 90 },
  result: { label: "Your result", progress: 100 },
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
    ["processing", "looks"],
    ["gate", "looks"],
    ["result", "gate"],
    ["error", "upload"],
  ];
  for (const [from, to] of BACK) {
    test(`back from ${from} goes to ${to}`, async ({ page }) => {
      await open(page, from);
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(page.locator("[data-screen]")).toHaveAttribute("data-screen", to);
    });
  }

  test("back from the upload screen returns to the site", async ({ page }) => {
    await open(page, "upload");
    await page.getByRole("button", { name: "Back to the site" }).click();
    await expect(page).toHaveURL(/\/$/);
  });
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
      if (request.url().includes("/api/tryon/")) calls.push(request.url());
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

  test("the words privacy notice link to /privacy, and nothing else is added", async ({ page }) => {
    await open(page, "consent");
    await expect(page.getByRole("link", { name: "privacy notice" })).toHaveAttribute("href", "/privacy");
    await expect(page.getByText("is two paragraphs long, and it is linked in the footer.")).toBeVisible();
  });
});

test.describe("stage and looks", () => {
  test("three stages, the first chosen", async ({ page }) => {
    await open(page, "stage");
    const stages = page.getByRole("radio");
    await expect(stages).toHaveCount(3);
    await expect(stages.first()).toBeChecked();
  });

  test("six looks; the button changes once one is picked", async ({ page }) => {
    await open(page, "looks");
    await expect(page.getByRole("radio")).toHaveCount(6);
    const next = page.getByRole("button", { name: "Choose one to continue" });
    await expect(next).toHaveAttribute("aria-disabled", "true");
    await page.getByText("Light density").first().click();
    await expect(page.getByRole("button", { name: "Generate the simulation" })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
  });
});

test.describe("processing", () => {
  test("ticks at 2, 6, 11 and 16 s, then opens the gate at 20 s", async ({ page }) => {
    await page.clock.install();
    await open(page, "processing");
    const status = page.getByRole("status");
    await expect(page.getByText("20s")).toHaveAttribute("aria-hidden", "true");
    await page.clock.runFor(2_000);
    await expect(status).toHaveText("Reading the photograph");
    await page.clock.runFor(4_000);
    await expect(status).toHaveText("Finding the hairline");
    await page.clock.runFor(5_000);
    await expect(status).toHaveText("Placing the hair");
    await page.clock.runFor(5_000);
    await expect(status).toHaveText("Matching the light");
    await page.clock.runFor(4_000);
    await expect(page.locator("[data-screen]")).toHaveAttribute("data-screen", "gate");
  });
});

test.describe("gate", () => {
  test("the number is optional, as its copy says: left empty, the result opens", async ({ page }) => {
    await open(page, "gate");
    await expect(page.getByText("The result opens on the next screen either way.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Show me the result" }).click();
    await expect(page.locator("[data-screen]")).toHaveAttribute("data-screen", "result");
  });

  test("a gate half filled in says what is missing, then shows the result", async ({ page }) => {
    await open(page, "gate");
    await page.getByLabel("Mobile").fill("98100");
    await page.getByRole("button", { name: "Show me the result" }).click();
    await expect(page.getByText("Tell us what to call you.")).toBeVisible();
    await expect(page.getByText("Enter all ten digits so we can send the result.")).toBeVisible();
    await expect(page.getByLabel("Name")).toHaveAttribute("aria-invalid", "true");
    await page.getByLabel("Name").fill("Test Visitor");
    await page.getByLabel("Mobile").fill("9810000000");
    await expect(page.getByLabel("Mobile")).toHaveValue("98100 00000");
    await page.getByRole("button", { name: "Show me the result" }).click();
    await expect(page.locator("[data-screen]")).toHaveAttribute("data-screen", "result");
  });

  test("the image column sits below the form under 760 px, beside it above", async ({ page }) => {
    await open(page, "gate");
    const form = await page.locator("form").boundingBox();
    const image = await page.getByText("Your result · ready").boundingBox();
    if ((page.viewportSize()?.width ?? 0) <= 760) expect(image?.y).toBeGreaterThan(form?.y ?? 0);
    else expect(image?.x ?? 0).toBeLessThan(form?.x ?? 0);
  });
});

test.describe("result", () => {
  test("a slider from 50%, the look, the disclaimer and three actions: one look per visitor", async ({ page }) => {
    await open(page, "result");
    await expect(page.getByRole("slider")).toHaveValue("50");
    await expect(page.getByText("Full density · Natural hairline · short")).toBeVisible();
    await expect(
      page.getByText("This is an illustrative simulation, not a photograph of a result.", { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Book a free consultation" })).toHaveAttribute("href", "/book");
    await expect(page.getByRole("button", { name: "Download" })).toBeVisible();
    await expect(page.getByRole("button", { name: "WhatsApp" })).toBeVisible();
    await expect(page.getByText("A copy is on its way to +91 98100 00000. Deleted after thirty days.")).toBeVisible();
    await expect(page.getByText("Try another look")).toHaveCount(0);
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
      kind: "lookLimit",
      step: "One look per visitor",
      frame: "Your look is no longer kept",
      heading: "You have had your look.",
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

  test("a returning visitor's look: the result alone, with no slider and no copy line", async ({ page }) => {
    await page.goto("/try?state=result&kind=returning");
    await expect(page.getByRole("heading", { name: "The look you had." })).toBeVisible();
    await expect(page.getByText("Each visitor gets one simulation, and this is yours.")).toBeVisible();
    await expect(page.getByRole("img", { name: "Simulated result" })).toBeVisible();
    await expect(page.getByRole("slider")).toHaveCount(0);
    await expect(page.getByText("A copy is on its way", { exact: false })).toHaveCount(0);
  });
});
