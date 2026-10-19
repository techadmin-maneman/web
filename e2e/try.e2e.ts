// The try-on's screens, opened directly with ?state= (docs/archive/feature-inventory.md,
// items 22–30). These make no API calls; try-flow.e2e.ts runs the flow on a
// mocked API, and try-api.e2e.ts on the local one. The look goes to WhatsApp
// only (ADR 0104): there is no processing or result screen, and the gate comes
// before the look is made.

import type { Page } from "@playwright/test";
import sharp from "sharp";
import { axeViolations } from "./a11y.ts";
import { drawnHeadPhoto, expect, fakeTurnstile, test, TINY_JPEG } from "./support.ts";
import * as siteCopy from "../site/src/content/site.ts";

test.beforeEach(async ({ page }) => {
  await fakeTurnstile(page);
});

const SCREENS = {
  upload: { label: "Step 1 of 3", progress: 24 },
  looks: { label: "Step 2 of 3", progress: 58 },
  gate: { label: "Step 3 of 3", progress: 90 },
  sent: { label: "Sent to WhatsApp", progress: 100 },
  error: { label: "Can’t use this photo", progress: 24 },
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
    ["looks", "upload"],
    ["gate", "looks"],
    ["error", "upload"],
  ];
  for (const [from, to] of BACK) {
    test(`back from ${from} goes to ${to}`, async ({ page }) => {
      await open(page, from);
      await page.getByRole("button", { name: siteCopy.tryOn.back, exact: true }).click();
      await expect(page.locator("[data-screen]")).toHaveAttribute("data-screen", to);
    });
  }

  for (const screen of ["upload", "sent"] as const) {
    test(`back from the ${screen} screen returns to the site`, async ({ page }) => {
      await open(page, screen);
      await page.getByRole("button", { name: siteCopy.tryOn.sent.home }).click();
      await expect(page).toHaveURL(/\/$/);
    });
  }
});

const capture = siteCopy.tryOn.upload.capture;

/** A front camera that films a drawn frame, light and not all one shade, for a browser that has none. */
async function fakeCamera(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 800;
    const devices = {
      enumerateDevices: () => Promise.resolve([{ kind: "videoinput", deviceId: "front", groupId: "", label: "" }]),
      getUserMedia: () => {
        const context = canvas.getContext("2d");
        if (context !== null) {
          context.fillStyle = "rgb(214, 204, 188)";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.fillStyle = "rgb(200, 162, 122)";
          context.beginPath();
          context.ellipse(320, 380, 150, 200, 0, 0, Math.PI * 2);
          context.fill();
        }
        return Promise.resolve(canvas.captureStream(30));
      },
    };
    Object.defineProperty(navigator, "mediaDevices", { value: devices, configurable: true });
  });
}

/** A camera the browser will not open: refused, as when the visitor said no to it. */
async function refusedCamera(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const devices = {
      enumerateDevices: () => Promise.resolve([{ kind: "videoinput", deviceId: "front", groupId: "", label: "" }]),
      getUserMedia: () => Promise.reject(new DOMException("refused", "NotAllowedError")),
    };
    Object.defineProperty(navigator, "mediaDevices", { value: devices, configurable: true });
  });
}

const cameraIn = (page: Page) => page.getByRole("dialog", { name: capture.title });

test.describe("upload", () => {
  test("three guidelines, two ways in, and no demo link to the error screen", async ({ page }) => {
    await fakeCamera(page);
    await open(page, "upload");
    await expect(page.locator("[data-screen] ol > li")).toHaveCount(3);
    await expect(page.getByRole("button", { name: siteCopy.tryOn.upload.choose })).toBeVisible();
    await expect(page.getByRole("button", { name: siteCopy.tryOn.upload.camera })).toBeVisible();
    await expect(page.getByText("See what happens if the photo will not work")).toHaveCount(0);
    await expect(page.locator('input[type="file"][capture="user"]')).toHaveCount(1);
  });

  // On a phone the shutter sat above the camera's view, below the fold, and the photo went on unseen.
  test("Take a photo opens the camera over the page, and the photo is looked at before it is used", async ({
    page,
  }) => {
    await fakeCamera(page);
    await open(page, "upload");
    await page.getByRole("button", { name: siteCopy.tryOn.upload.camera }).click();
    const camera = cameraIn(page);
    await expect(camera.locator("video")).toBeVisible();
    await expect(camera.getByText(capture.hint)).toBeVisible();
    const shutter = camera.getByRole("button", { name: capture.shutter });
    await expect(shutter).toBeEnabled();
    expect(await axeViolations(page)).toEqual([]);

    // On a phone the camera is the whole screen, and the shutter sits at its foot, in the middle, under a thumb.
    const screen = page.viewportSize() ?? { width: 0, height: 0 };
    if (screen.width <= 760) {
      const frame = await camera.boundingBox();
      const button = await shutter.boundingBox();
      expect([frame?.width, frame?.height]).toEqual([screen.width, screen.height]);
      expect(button?.y ?? 0).toBeGreaterThan(screen.height * 0.75);
      expect(Math.abs((button?.x ?? 0) + (button?.width ?? 0) / 2 - screen.width / 2)).toBeLessThan(2);
    }

    await shutter.click();
    await expect(camera.getByRole("img", { name: capture.still })).toBeVisible();
    await expect(camera.getByText(capture.check)).toBeVisible();
    await camera.getByRole("button", { name: capture.retake }).click();
    await expect(camera.locator("video")).toBeVisible();
    await camera.getByRole("button", { name: capture.shutter }).click();
    await camera.getByRole("button", { name: capture.use }).click();
    await expect(page.locator("[data-screen]")).toHaveAttribute("data-screen", "looks");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("a phone’s Back closes the camera and stays on the photo step", async ({ page }) => {
    await fakeCamera(page);
    await open(page, "upload");
    await page.getByRole("button", { name: siteCopy.tryOn.upload.camera }).click();
    await expect(cameraIn(page).locator("video")).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("[data-screen]")).toHaveAttribute("data-screen", "upload");
    expect(new URL(page.url()).pathname).toBe("/try");
  });

  test("a camera the browser blocks says so, and Take a photo then asks for the phone’s own", async ({ page }) => {
    await refusedCamera(page);
    await open(page, "upload");
    const take = page.getByRole("button", { name: siteCopy.tryOn.upload.camera });
    await take.click();
    await expect(page.getByText(siteCopy.tryOn.upload.blocked)).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const chooser = page.waitForEvent("filechooser");
    await take.click();
    expect(await (await chooser).element().getAttribute("capture")).toBe("user");
  });

  test("a device with no camera is offered only the photo it has", async ({ page }) => {
    await page.addInitScript(() => {
      const devices = { enumerateDevices: () => Promise.resolve([]) };
      Object.defineProperty(navigator, "mediaDevices", { value: devices, configurable: true });
    });
    await open(page, "upload");
    await expect(page.getByRole("button", { name: siteCopy.tryOn.upload.choose })).toBeVisible();
    await expect(page.getByRole("button", { name: siteCopy.tryOn.upload.camera })).toHaveCount(0);
  });

  // On a phone the caption sat across the oval's lower corner brackets; there, the camera opens over the page.
  test("the frame’s caption sits below the oval and its brackets, and a phone draws no empty frame", async ({
    page,
  }) => {
    await open(page, "upload");
    const caption = page.getByText(siteCopy.tryOn.upload.previewCaption);
    if ((page.viewportSize()?.width ?? 0) <= 760) {
      await expect(caption).toBeHidden();
      return;
    }
    const oval = await page.locator("svg").filter({ hasText: siteCopy.tryOn.upload.oval }).boundingBox();
    const box = await caption.boundingBox();
    expect(box?.y ?? 0).toBeGreaterThanOrEqual((oval?.y ?? 0) + (oval?.height ?? 0));
  });

  test("a chosen photo is looked at first, and goes on to the looks once used", async ({ page }) => {
    await open(page, "upload");
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles(await drawnHeadPhoto());
    const camera = cameraIn(page);
    await expect(camera.getByRole("img", { name: capture.still })).toBeVisible();
    await expect(camera.getByRole("button", { name: capture.another })).toBeVisible();
    await camera.getByRole("button", { name: capture.use }).click();
    await expect(page.locator("[data-screen]")).toHaveAttribute("data-screen", "looks");
    await page.getByRole("button", { name: siteCopy.tryOn.back, exact: true }).click();
    await expect(page.getByRole("img", { name: siteCopy.tryOn.upload.previewAlt })).toBeVisible();
  });

  test("a dark photo is said to be dark before it is used", async ({ page }) => {
    await open(page, "upload");
    const { buffer } = await drawnHeadPhoto();
    const dark = await sharp(buffer).linear(0.2, 0).jpeg().toBuffer();
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({ name: "dark.jpg", mimeType: "image/jpeg", buffer: dark });
    await expect(cameraIn(page).getByRole("status")).toHaveText(capture.dark);
  });

  test("a photograph too small for the API is refused before anything is sent", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (request) => {
      // On arrival the page asks whether this browser has had its look, and whether the try-on runs; the
      // photograph never leaves.
      const arrival = ["/api/tryon/look", "/api/tryon/availability"].some((path) => request.url().endsWith(path));
      if (request.url().includes("/api/tryon/") && !arrival) calls.push(request.url());
    });
    await open(page, "upload");
    await page.locator('input[type="file"]').first().setInputFiles(TINY_JPEG);
    await cameraIn(page).getByRole("button", { name: capture.use }).click();
    await expect(page.locator("[data-screen]")).toHaveAttribute("data-screen", "error");
    await expect(page.getByRole("heading", { name: siteCopy.tryOn.error.kinds.photo.title })).toBeVisible();
    expect(calls).toEqual([]);
  });
});

// The try-on asked for its photo on a screen of its own, five rows and a box; now one line, which using it agrees to.
test.describe("the photo's agreement", () => {
  test("is one line on the photo, linking to the try-on notice in a new tab", async ({ page }) => {
    await open(page, "upload");
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles(await drawnHeadPhoto());
    const camera = cameraIn(page);
    await expect(camera.getByText("By using this photo, you agree to our try-on notice.")).toBeVisible();
    const notice = camera.getByRole("link", { name: "try-on notice" });
    await expect(notice).toHaveAttribute("href", "/notices#try-on");
    await expect(notice).toHaveAttribute("target", "_blank");
    await expect(page.getByRole("checkbox")).toHaveCount(0);
  });

  test("the gate's is one line beneath its button, linking to the same notice", async ({ page }) => {
    await open(page, "gate");
    await expect(page.getByText("By sending it, you agree to our try-on notice.")).toBeVisible();
    await expect(page.getByRole("link", { name: "try-on notice" })).toHaveAttribute("href", "/notices#try-on");
  });
});

test.describe("looks", () => {
  test("six looks; the button changes once one is picked, and goes on to the gate", async ({ page }) => {
    await open(page, "looks");
    await expect(page.getByRole("radio")).toHaveCount(6);
    // Each of the six looks shows its reference photograph's crop.
    await expect(page.getByText("Preview", { exact: true })).toHaveCount(0);
    await expect(page.locator("[data-screen] fieldset img")).toHaveCount(6);
    const next = page.getByRole("button", { name: siteCopy.tryOn.looks.choose });
    await expect(next).toHaveAttribute("aria-disabled", "true");
    await page.getByRole("radio", { name: /Quiff/ }).check();
    const onward = page.getByRole("button", { name: siteCopy.tryOn.looks.continue });
    await expect(onward).toHaveAttribute("aria-disabled", "false");
    await onward.click();
    await expect(page.locator("[data-screen]")).toHaveAttribute("data-screen", "gate");
  });
});

test.describe("gate", () => {
  // ADR 0104: the look is sent to the number, so the gate needs it, and says so.
  test("asks where to send the look before it is made, and needs both fields", async ({ page }) => {
    await open(page, "gate");
    await expect(page.getByRole("heading", { name: siteCopy.tryOn.gate.title })).toBeVisible();
    await expect(page.getByText(siteCopy.tryOn.gate.caption)).toBeAttached();
    await expect(page.getByLabel(siteCopy.tryOn.gate.name)).toHaveAttribute("aria-required", "true");
    await expect(page.getByLabel(siteCopy.tryOn.gate.mobile)).toHaveAttribute("aria-required", "true");
    await page.getByRole("button", { name: siteCopy.tryOn.gate.submit }).click();
    await expect(page.getByText(siteCopy.tryOn.gate.nameError)).toBeVisible();
    await expect(page.getByText(siteCopy.tryOn.gate.mobileError)).toBeVisible();
    await expect(page.getByLabel(siteCopy.tryOn.gate.name)).toBeFocused();
    await expect(page.locator("[data-screen]")).toHaveAttribute("data-screen", "gate");
  });

  // A number starting with 5 is not a mobile, and the gate says so at the field.
  test("a gate half filled in says what is missing, focused, then sends the look", async ({ page }) => {
    await open(page, "gate");
    await page.getByLabel(siteCopy.tryOn.gate.mobile).fill("98100");
    await page.getByRole("button", { name: siteCopy.tryOn.gate.submit }).click();
    await expect(page.getByText(siteCopy.tryOn.gate.nameError)).toBeVisible();
    await expect(page.getByLabel(siteCopy.tryOn.gate.name)).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel(siteCopy.tryOn.gate.name)).toBeFocused();
    await page.getByLabel(siteCopy.tryOn.gate.name).fill("Test Visitor");
    await page.getByLabel(siteCopy.tryOn.gate.mobile).fill("5876543210");
    await page.getByRole("button", { name: siteCopy.tryOn.gate.submit }).click();
    await expect(page.getByLabel(siteCopy.tryOn.gate.mobile)).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel(siteCopy.tryOn.gate.mobile)).toHaveAccessibleDescription(
      siteCopy.tryOn.gate.mobileError,
    );
    await expect(page.getByLabel(siteCopy.tryOn.gate.mobile)).toBeFocused();
    await page.getByLabel(siteCopy.tryOn.gate.mobile).fill("9810000000");
    await expect(page.getByLabel(siteCopy.tryOn.gate.mobile)).toHaveValue("98100 00000");
    await page.getByRole("button", { name: siteCopy.tryOn.gate.submit }).click();
    await expect(page.locator("[data-screen]")).toHaveAttribute("data-screen", "sent");
  });

  // On a phone its caption trailed under the button's line, saying again what the title says.
  test("the image column goes on a phone, sits below the form under 760 px, and beside it above", async ({ page }) => {
    await open(page, "gate");
    const caption = page.getByText(siteCopy.tryOn.gate.caption);
    if ((page.viewportSize()?.width ?? 0) <= 600) {
      await expect(caption).toBeHidden();
      return;
    }
    const form = await page.locator("form").boundingBox();
    const image = await caption.boundingBox();
    if ((page.viewportSize()?.width ?? 0) <= 760) expect(image?.y).toBeGreaterThan(form?.y ?? 0);
    else expect(image?.x ?? 0).toBeLessThan(form?.x ?? 0);
  });

  // On a phone an empty frame sat under the form, its label across the gilt divider.
  test("hides the empty frame under 600 px, and keeps its label inside its half above", async ({ page }) => {
    await open(page, "gate");
    const label = page.getByText(siteCopy.tryOn.gate.frame);
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
    await expect(page.getByRole("heading", { name: siteCopy.tryOn.sent.title })).toBeVisible();
    await expect(
      page.getByText("It’ll reach WhatsApp on +91 98100 00000 within minutes. We delete it after 14 days."),
    ).toBeVisible();
    await expect(page.getByText("never shown on this site", { exact: false })).toHaveCount(0);
    const screen = page.locator("[data-screen]");
    await expect(screen.getByRole("link", { name: siteCopy.tryOn.sent.book })).toHaveAttribute("href", "/book");
    await expect(screen.getByRole("link", { name: siteCopy.tryOn.sent.home })).toHaveAttribute("href", "/");
    await expect(page.locator("[data-screen] img")).toHaveCount(0);
    await expect(page.getByRole("slider")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Download" })).toHaveCount(0);
  });

  test("tells a returning visitor their look was sent, without a number or the look", async ({ page }) => {
    await page.goto("/try?state=sent&kind=returning");
    await expect(page.getByRole("heading", { name: siteCopy.tryOn.sent.returning.title })).toBeVisible();
    await expect(page.getByText("We sent it to the WhatsApp number you gave.", { exact: false })).toBeVisible();
    await expect(page.getByText("+91", { exact: false })).toHaveCount(0);
    await expect(page.locator("[data-screen] img")).toHaveCount(0);
  });
});

test.describe("error", () => {
  test("Choose another returns to the upload; Book a consultation instead goes to /book", async ({ page }) => {
    await open(page, "error");
    await expect(page.getByRole("heading", { name: siteCopy.tryOn.error.kinds.photo.title })).toBeVisible();
    await expect(page.getByRole("link", { name: siteCopy.tryOn.error.book })).toHaveAttribute("href", "/book");
    await page.getByRole("button", { name: siteCopy.tryOn.error.another }).click();
    await expect(page.locator("[data-screen]")).toHaveAttribute("data-screen", "upload");
  });

  const KINDS = [
    {
      kind: "renderFailed",
      step: "Something went wrong",
      frame: "The look didn’t work",
      heading: "The look didn’t work this time.",
      another: true,
    },
    {
      kind: "busy",
      step: "Please try again shortly",
      frame: "The try-on is busy",
      heading: "The try-on is busy just now.",
      another: true,
    },
    {
      kind: "unavailable",
      step: "Not available right now",
      frame: "WhatsApp",
      heading: "We can’t send to WhatsApp just now.",
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
      await expect(page.getByRole("link", { name: siteCopy.tryOn.error.book })).toBeVisible();
      await expect(page.getByRole("button", { name: siteCopy.tryOn.error.another })).toHaveCount(another ? 1 : 0);
    });
  }
});
