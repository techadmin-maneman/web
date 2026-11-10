// Me, in the new look: reached from its tab, with the technician's month, leave, what waits to send, ops, and signing
// out, which the shell's own test runs through (e2e/tech/shell.e2e.ts).

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fakeTech } from "./fake-tech.ts";
import { tab } from "./tabs.ts";
import * as techCopy from "../../apps/tech/src/content.ts";

test("opens from its tab, and lists the month, leave, what waits to send, and the way to ops", async ({ page }) => {
  await fakeTech(page);
  await page.goto("/");
  await tab(page, techCopy.tabs.me).click();

  await expect(page.getByRole("heading", { level: 1, name: techCopy.me.title })).toBeVisible();
  await expect(tab(page, techCopy.tabs.me)).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: techCopy.me.month })).toHaveAttribute("href", "/month");
  await expect(page.getByRole("link", { name: techCopy.me.leave, exact: true })).toHaveAttribute("href", "/leave");
  await expect(page.getByRole("link", { name: new RegExp(`^${techCopy.me.pending}`) })).toContainText(
    techCopy.me.nothingPending,
  );
  await expect(page.getByRole("link", { name: techCopy.ops.call })).toHaveAttribute("href", /^tel:\+/);
  expect(await axeViolations(page)).toEqual([]);
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
