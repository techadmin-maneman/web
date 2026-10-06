// The client app's shell (docs/decisions/0043-client-app.md): served as the
// mm-app Worker serves it, under its own policy, on the client surface's host,
// and the frame every signed-in page shares.

import type { Locator, Page } from "@playwright/test";
import sharp from "sharp";
import { expect, outsideContract, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fittedClient } from "./fitted.ts";
import { logIn } from "./signed-in.ts";

type Rgb = readonly [number, number, number];

/** "rgb(22, 35, 58)" → [22, 35, 58]. */
const rgbOf = (css: string): Rgb => {
  const [r = 0, g = 0, b = 0] = (css.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  return [r, g, b];
};

/** WCAG's contrast ratio between two colours. */
function contrast(one: Rgb, other: Rgb): number {
  const luminance = (rgb: Rgb) => {
    const [r = 0, g = 0, b = 0] = rgb.map((value) => {
      const channel = value / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(one), luminance(other)].sort((a, b) => b - a);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

const style = (locator: Locator, property: string) =>
  locator.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);

async function home(page: Page): Promise<void> {
  await logIn(page, fittedClient().mobile);
  await expect(page.getByRole("link", { name: "Your profile" })).toBeVisible();
}

test("opens on the mobile number, as the design draws it", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Your mobile number · Mane Man");
  await expect(page.getByRole("heading", { level: 1, name: "Your mobile number" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Mobile number" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send code on WhatsApp" })).toBeVisible();
  await expect(page.getByText("A six-digit code, no password.")).toBeVisible();
});

test("serves its policy: its own origin only, WebOTP, and noindex", async ({ page }) => {
  const response = await page.goto("/");
  const headers = response?.headers() ?? {};
  expect(headers["content-security-policy"]).toContain("default-src 'none'");
  expect(headers["content-security-policy"]).toContain("connect-src 'self'");
  expect(headers["permissions-policy"]).toContain("otp-credentials=(self)");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
});

test("answers any page path with the app, as a single-page app", async ({ page }) => {
  const response = await page.goto("/profile");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("reaches mm-api as the client surface, on its own host", async ({ page }) => {
  await page.goto("/");
  const statuses = await page.evaluate(async () => {
    const [health, pincode, me] = await Promise.all(
      ["/api/health", "/api/pincodes/122018", "/api/me"].map((path) => fetch(path)),
    );
    return { health: health?.status, pincode: pincode?.status, me: me?.status };
  });
  expect(statuses).toEqual({ health: 200, pincode: 404, me: 401 });
});

test("says the error when the API cannot be reached, with a way to try again", async ({ page }) => {
  await page.route("**/api/me", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "We couldn’t load your visit." })).toBeVisible();
  await expect(page).toHaveTitle("We couldn’t load your visit. · Mane Man");
  await expect(page.getByRole("link", { name: "Message us" })).toHaveAttribute("href", "https://wa.me/919007973247");
  expect(await axeViolations(page)).toEqual([]);

  await page.unroute("**/api/me");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your mobile number" })).toBeVisible();
});

test("shows the loading shape on paper while it asks whether there is a session, not a blank screen", async ({
  page,
}) => {
  let answer: () => void = () => undefined;
  const asked = new Promise<void>((resolve) => {
    answer = resolve;
  });
  await page.route("**/api/me", async (route) => {
    await asked;
    await route.continue();
  });
  await page.goto("/");
  await expect(page.getByRole("status").filter({ hasText: "Loading" })).toBeAttached();
  expect(await page.evaluate(() => document.body.dataset.ground)).toBe("paper");
  answer();
  await expect(page.getByRole("heading", { level: 1, name: "Your mobile number" })).toBeVisible();
  expect(await page.evaluate(() => document.body.dataset.ground)).toBe("ink");
});

test("keeps its column to a large phone's width on a wide screen, centred", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const box = await page.locator("#root").boundingBox();
  expect(box?.width).toBe(480);
  expect(Math.round((box?.x ?? 0) * 2 + (box?.width ?? 0))).toBe(1440);
});

test("meets WCAG 2.2 AA", async ({ page }) => {
  await page.goto("/");
  expect(await axeViolations(page)).toEqual([]);
});

test("names each page in the browser's title, and takes focus to its heading", async ({ page }) => {
  await home(page);
  await expect(page).toHaveTitle("Home · Mane Man");
  const tabs = page.getByRole("navigation");
  for (const tab of ["Visits", "Photos", "Payments", "Refer"]) {
    await tabs.getByRole("link", { name: tab }).click();
    await expect(page).toHaveTitle(`${tab} · Mane Man`);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeFocused();
  }
});

test("opens Home, not a blank page, at a path every JavaScript object answers to", async ({ page }) => {
  await home(page);
  await page.goto("/constructor");
  await expect(page.getByRole("link", { name: "Your profile" })).toBeVisible();
});

test("offers a way on, not a blank page, when a page fails to draw", async ({ page }) => {
  await home(page);
  // An answer the page cannot draw.
  outsideContract("GET /api/payments 200");
  await page.route("**/api/payments", (route) => route.fulfill({ json: { entries: null } }));
  await page.getByRole("navigation").getByRole("link", { name: "Payments" }).click();
  await expect(page.getByRole("alert")).toContainText("This page didn’t open.");
  await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
});

test("makes each tab a full 64 px target", async ({ page }) => {
  await home(page);
  const tab = await page.getByRole("navigation").getByRole("link", { name: "Home" }).boundingBox();
  expect(tab?.height).toBeGreaterThanOrEqual(64);
});

test("fills a phone wider than the design, its header's rule and tab bar to the edges", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await home(page);
  expect((await page.locator("#root").boundingBox())?.width).toBe(430);
  const { data, info } = await sharp(await page.screenshot())
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number): Rgb => {
    const index = (y * info.width + x) * info.channels;
    return [data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0];
  };
  const header = await page.locator("header").boundingBox();
  const tabs = await page.getByRole("navigation").boundingBox();
  const ruleY = Math.floor((header?.y ?? 0) + (header?.height ?? 0) - 1);
  const tabsY = Math.floor((tabs?.y ?? 0) + (tabs?.height ?? 0) / 2);
  // Four pixels in from the screen's edge: the rule's colour, and the tab bar's ground.
  expect(at(4, ruleY)).toEqual(rgbOf("rgb(206, 198, 180)"));
  expect(at(info.width - 4, ruleY)).toEqual(rgbOf("rgb(206, 198, 180)"));
  expect(at(4, tabsY)).toEqual(rgbOf("rgb(244, 241, 233)"));
  expect(at(info.width - 4, tabsY)).toEqual(rgbOf("rgb(244, 241, 233)"));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(430);
});

test("never cuts a focus ring at the page's scrolling edges", async ({ page }) => {
  // A small phone, where more of each page sits against the edges it scrolls under.
  await page.setViewportSize({ width: 360, height: 640 });
  await home(page);
  const pages = [
    { path: "/visits", heading: "Visits" },
    { path: "/payments", heading: "Payments" },
    { path: "/profile", heading: "Rohit Malhotra" },
  ];
  for (const { path, heading } of pages) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    for (let press = 0; press < 40; press += 1) {
      await page.keyboard.press("Tab");
      const cut = await page.evaluate(() => {
        const focused = document.activeElement;
        const scroller = focused?.closest("main");
        if (!(focused instanceof HTMLElement) || scroller === null || scroller === undefined) return null;
        const ring = getComputedStyle(focused);
        // A ring drawn inside, with a negative offset, reaches no further than the control's own edge.
        const reach = Math.max(0, Number.parseFloat(ring.outlineWidth) + Number.parseFloat(ring.outlineOffset));
        const [box, edge] = [focused.getBoundingClientRect(), scroller.getBoundingClientRect()];
        const inside =
          box.top - reach >= edge.top - 0.5 &&
          box.bottom + reach <= edge.bottom + 0.5 &&
          box.left - reach >= edge.left - 0.5 &&
          box.right + reach <= edge.right + 0.5;
        return inside ? null : focused.textContent.trim().slice(0, 40);
      });
      expect(cut, `${path}: the focus ring of "${String(cut)}" is cut by the page's edge`).toBeNull();
    }
  }
});

test("edges fields and switches at 3:1 or more against the ground (WCAG 1.4.11)", async ({ page }) => {
  await page.goto("/");
  const mobile = page.getByRole("textbox", { name: "Mobile number" }).locator("..");
  const ink = rgbOf(await style(page.locator("body"), "background-color"));
  expect(contrast(rgbOf(await style(mobile, "border-top-color")), ink)).toBeGreaterThanOrEqual(3);

  await home(page);
  await page.getByRole("link", { name: "Your profile" }).click();
  const paper = rgbOf(await style(page.locator("body"), "background-color"));
  const off = page.getByRole("switch", { checked: false }).first();
  await expect(off).toBeVisible();
  expect(contrast(rgbOf(await style(off, "border-top-color")), paper)).toBeGreaterThanOrEqual(3);
  const field = page.getByRole("textbox", { name: "New number" }).locator("..");
  expect(contrast(rgbOf(await style(field, "border-top-color")), paper)).toBeGreaterThanOrEqual(3);
  expect(contrast(rgbOf(await style(field, "border-top-color")), rgbOf("rgb(255, 255, 255)"))).toBeGreaterThanOrEqual(
    3,
  );

  // A switch is drawn small, as the design draws it, and answers a tap 44 px tall.
  const box = await off.boundingBox();
  const middle = { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 };
  const hit = await page.evaluate(
    ({ x, y }) => [y - 21, y + 21].map((edge) => document.elementFromPoint(x, edge)?.getAttribute("role") ?? null),
    middle,
  );
  expect(hit).toEqual(["switch", "switch"]);
});

test("moves nothing under reduced motion, the share sheet included", async ({ page }) => {
  await home(page);
  await page.getByRole("navigation").getByRole("link", { name: "Refer" }).click();
  await page.getByRole("button", { name: "Share an invite" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  expect(await style(sheet, "animation-name")).toBe("none");
});
