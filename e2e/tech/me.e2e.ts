// Me, in the new look: reached from its tab, with who the technician is, their quality and incentives
// (./mine.e2e.ts), leave, what waits to send, ops, and signing out, which the shell's own test runs through
// (e2e/tech/shell.e2e.ts).

import { randomUUID } from "node:crypto";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fakeTech } from "./fake-tech.ts";
import { tab } from "./tabs.ts";
import * as techCopy from "../../apps/tech/src/content.ts";

test("opens from its tab, and lists leave, what waits to send, and the way to ops", async ({ page }) => {
  const fake = await fakeTech(page);
  // Two asks still with ops and one ops answered: the row counts the two.
  const ask = (state: "asked" | "approved") => ({
    id: randomUUID(),
    from: "2030-08-04",
    to: "2030-08-05",
    note: null,
    state,
    requested_at: "2030-07-01T05:00:00.000Z",
  });
  fake.leave = { requests: [ask("asked"), ask("asked"), ask("approved")] };
  await page.goto("/");
  await tab(page, techCopy.tabs.me).click();

  await expect(page.getByRole("heading", { level: 1, name: techCopy.me.title })).toBeVisible();
  await expect(tab(page, techCopy.tabs.me)).toHaveAttribute("aria-current", "page");
  const leave = page.getByRole("link", { name: new RegExp(`^${techCopy.me.leave}`) });
  await expect(leave).toHaveAttribute("href", "/leave");
  await expect(leave).toContainText(techCopy.me.withOps(2));
  await expect(page.getByRole("link", { name: new RegExp(`^${techCopy.me.pending}`) })).toContainText(
    techCopy.me.nothingPending,
  );
  expect(await axeViolations(page)).toEqual([]);

  // Contact ops is a row, as the prototype draws it, opening ops in the technician's city with Call filled.
  await page.getByRole("button", { name: techCopy.me.contact }).click();
  const contact = page.getByRole("dialog");
  await expect(contact.getByRole("heading", { level: 2 })).toHaveText(/^Ops, |^Contact ops$/);
  await expect(contact.getByRole("link", { name: techCopy.ops.callShort })).toHaveAttribute("href", /^tel:\+/);
  await expect(contact.getByRole("link", { name: techCopy.ops.whatsAppShort })).toBeVisible();
});

test("keeps the tab bar on every top-level screen, and none inside a job", async ({ page }) => {
  await fakeTech(page);
  await page.goto("/");
  const bar = page.getByRole("navigation", { name: techCopy.tabs.label });
  await expect(bar).toBeVisible();
  await expect(tab(page, techCopy.tabs.today)).toHaveAttribute("aria-current", "page");

  await tab(page, techCopy.tabs.kit).click();
  await expect(page.getByRole("heading", { level: 1, name: techCopy.kit.title })).toBeVisible();
  await expect(tab(page, techCopy.tabs.kit)).toHaveAttribute("aria-current", "page");

  await tab(page, techCopy.tabs.today).click();
  await page.getByText("Rohit M.").first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Rohit M." })).toBeVisible();
  await expect(bar).toHaveCount(0);
});

test("signs out once, however often Sign out is tapped while it goes", async ({ page }) => {
  const fake = await fakeTech(page);
  let answer: (() => void) | undefined;
  fake.signOutHeld = new Promise((resolve) => {
    answer = resolve;
  });
  const logouts: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/tech/auth/logout")) logouts.push(request.url());
  });
  await page.goto("/me");
  const signOut = page.getByRole("button", { name: techCopy.me.signOut, exact: true });
  await signOut.click();
  await page.getByRole("dialog").getByRole("button", { name: techCopy.me.signOut, exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => logouts.length).toBe(1);

  // Tapped again while the first is on its way, still on Me: no second question.
  await signOut.click();
  await page.waitForTimeout(300);
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 0 });
  await expect(page.getByRole("heading", { level: 1, name: techCopy.me.title })).toBeVisible();

  // The answer comes: one sign-out, and the sign-in.
  answer?.();
  await expect(page.getByRole("heading", { level: 1, name: techCopy.signIn.title })).toBeVisible();
  expect(logouts).toHaveLength(1);
});
