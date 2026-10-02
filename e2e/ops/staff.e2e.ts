// Settings · Staff: who may use the console and for what, the switch that enforces it, and the service tokens let
// in. As every panel of Settings does, it shows a change before it is sent, and says why one was refused.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, fails, json, type Answers, type OpsReply } from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const AT = "2026-09-24T07:03:54.415Z";

const BOOK: OpsReply<"/api/staff"> = {
  enforced: { on: false, set_by: null, set_at: null },
  may_run_access: true,
  people: [
    {
      email: "owner@maneman.in",
      active: true,
      grants: [
        { department: "admin", level: "manage", geography: "national", place: null },
        { department: "finance", level: "manage", geography: "national", place: null },
      ],
      added_by: "migration 0069",
      added_at: AT,
      changed_by: null,
      changed_at: null,
    },
    {
      email: "noida.lead@maneman.in",
      active: false,
      grants: [{ department: "operations", level: "act", geography: "city", place: "Noida" }],
      added_by: "owner@maneman.in",
      added_at: AT,
      changed_by: "owner@maneman.in",
      changed_at: AT,
    },
  ],
  service_tokens: [
    { client_id: "a1b2c3d4.access", label: "In use before the Staff list", added_by: "migration 0069", added_at: AT },
  ],
  zones: [{ name: "NCR", cities: ["Gurgaon", "Delhi", "Noida", "Faridabad", "Ghaziabad"] }],
  cities: ["Gurgaon", "Delhi", "Noida", "Faridabad", "Ghaziabad", "Mumbai", "Bengaluru"],
};

async function open(page: Page, extra: Answers = {}): Promise<void> {
  await answer(page, { "GET /api/staff": json(BOOK), ...extra });
  await page.goto("/settings/staff");
  await expect(page.getByRole("heading", { level: 2, name: "Staff" })).toBeVisible();
}

const posted = (page: Page, path: string) =>
  page.waitForRequest((request) => request.url().endsWith(path) && request.method() === "POST");

const row = (page: Page, name: string) => page.getByRole("row").filter({ has: page.getByRole("rowheader", { name }) });

test("lists each person with their access and whether they are let in", async ({ page }) => {
  await open(page);
  await expect(page).toHaveTitle("Staff · Settings · Mane Man operations");

  const owner = row(page, "owner@maneman.in");
  await expect(owner).toContainText("Admin · Manage · National");
  await expect(owner).toContainText("Finance · Manage · National");
  await expect(owner).toContainText("Let in");
  await expect(row(page, "noida.lead@maneman.in")).toContainText("Operations · Act · Noida");
  await expect(row(page, "noida.lead@maneman.in")).toContainText("Switched off");
  await expect(page.getByText("a1b2c3d4.access")).toBeVisible();
});

test("adds a person only after the check names what they are given", async ({ page }) => {
  await open(page, { "POST /api/staff": json(BOOK) });
  await page.getByRole("button", { name: "Add a person" }).click();
  const form = page.getByRole("form", { name: "Add a person" });
  await form.getByLabel("Sign-in e-mail").fill("delhi.lead@maneman.in");
  await form.getByLabel("Department").selectOption("finance");
  await form.getByLabel("Level").selectOption("act");
  await form.getByLabel("Where").selectOption("city:Delhi");
  await form.getByRole("button", { name: "Review" }).click();

  const check = page.getByRole("group", { name: "Check the change" });
  await expect(check).toContainText("Adds delhi.lead@maneman.in.");
  await expect(check).toContainText("Gives Finance · Act · Delhi");

  const request = posted(page, "/api/staff");
  await check.getByRole("button", { name: "Save it" }).click();
  expect((await request).postDataJSON()).toEqual({
    email: "delhi.lead@maneman.in",
    active: true,
    grants: [{ department: "finance", level: "act", geography: "city", place: "Delhi" }],
  });
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
});

test("sends someone already listed to Change, rather than replacing their access unseen", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Add a person" }).click();
  const form = page.getByRole("form", { name: "Add a person" });
  await form.getByLabel("Sign-in e-mail").fill("Owner@ManeMan.in");
  await form.getByRole("button", { name: "Review" }).click();

  await expect(page.getByRole("alert")).toHaveText(
    "This person is already on the list. Use Change beside their e-mail.",
  );
  await expect(page.getByRole("group", { name: "Check the change" })).toHaveCount(0);
});

test("says why a change was refused", async ({ page }) => {
  await open(page, { "POST /api/staff": fails(409, "last_admin") });
  await page.getByRole("button", { name: "Change owner@maneman.in" }).click();
  await page.getByLabel("Let them in").uncheck();
  await page.getByRole("button", { name: "Review" }).click();
  const check = page.getByRole("group", { name: "Check the change" });
  await expect(check).toContainText("Switches them off: the console closes to them.");
  await check.getByRole("button", { name: "Save it" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Someone must keep Admin · Manage nationally. Give it to another person first.",
  );
});

test("starts enforcing only after the check, for someone who may switch it", async ({ page }) => {
  const enforced = { ...BOOK, enforced: { on: true, set_by: "owner@maneman.in", set_at: AT } };
  await open(page, { "POST /api/staff/enforcement": json(enforced) });
  await page.getByRole("button", { name: "Start enforcing" }).click();
  const check = page.getByRole("group", { name: "Start enforcing access?" });
  const request = posted(page, "/api/staff/enforcement");
  await check.getByRole("button", { name: "Start enforcing" }).click();
  expect((await request).postDataJSON()).toEqual({ on: true });
  await expect(page.getByRole("button", { name: "Stop enforcing" })).toBeVisible();
});

test("offers the switch and the service tokens to nobody without Admin · Manage nationally", async ({ page }) => {
  await open(page, { "GET /api/staff": json({ ...BOOK, may_run_access: false }) });
  await expect(page.getByRole("button", { name: "Start enforcing" })).toHaveCount(0);
  await expect(page.getByText("Only someone with Admin · Manage nationally can switch this.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
  await expect(page.getByRole("form", { name: "Add the token" })).toHaveCount(0);
  await expect(page.getByText("Only someone with Admin · Manage nationally can change service tokens.")).toBeVisible();
});

test("meets WCAG 2.2 AA", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Add a person" }).click();
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});
