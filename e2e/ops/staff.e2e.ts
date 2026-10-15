// Admin · Staff: who may use the console and for what, the switch that enforces it, and the service tokens let
// in. As every panel of Settings does, it shows a change before it is sent, and says why one was refused.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, fails, json, type Answers, type OpsReply } from "./fixtures.ts";
import { expectOneBoxALine } from "./one-box-a-line.ts";
import { settings as settingsCopy } from "../../apps/ops/src/content/settings.ts";
import { review } from "../../apps/ops/src/content/common.ts";

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
  await page.goto("/staff");
  await expect(page.getByRole("heading", { level: 2, name: settingsCopy.staff.title })).toBeVisible();
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
  await expect(owner).toContainText(settingsCopy.suppliers.active);
  await expect(row(page, "noida.lead@maneman.in")).toContainText("Operations · Act · Noida");
  await expect(row(page, "noida.lead@maneman.in")).toContainText(settingsCopy.staff.inactive);
  await expect(page.getByText("a1b2c3d4.access")).toBeVisible();
});

test("adds a person only after the check names what they are given", async ({ page }) => {
  await open(page, { "POST /api/staff": json(BOOK) });
  await page.getByRole("button", { name: settingsCopy.staff.add }).click();
  const form = page.getByRole("group", { name: settingsCopy.staff.add });
  await form.getByLabel(settingsCopy.staff.form.email).fill("delhi.lead@maneman.in");
  await form.getByLabel(settingsCopy.staff.form.department).selectOption("finance");
  await form.getByLabel(settingsCopy.staff.form.level).selectOption("act");
  await form.getByLabel(settingsCopy.staff.form.place).selectOption("city:Delhi");
  await form.getByRole("button", { name: review.next }).click();

  const check = page.getByRole("group", { name: review.title });
  await expect(check).toContainText("Adds delhi.lead@maneman.in.");
  await expect(check).toContainText("Grants Finance · Act · Delhi");

  const request = posted(page, "/api/staff");
  await check.getByRole("button", { name: review.send }).click();
  expect((await request).postDataJSON()).toEqual({
    email: "delhi.lead@maneman.in",
    active: true,
    grants: [{ department: "finance", level: "act", geography: "city", place: "Delhi" }],
  });
  await expect(page.getByRole("status").filter({ hasText: settingsCopy.rules.saved })).toBeVisible();
});

test("sends someone already listed to Change, rather than replacing their access unseen", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: settingsCopy.staff.add }).click();
  const form = page.getByRole("group", { name: settingsCopy.staff.add });
  await form.getByLabel(settingsCopy.staff.form.email).fill("Owner@ManeMan.in");
  await expect(form.getByRole("button", { name: review.next })).toBeDisabled();

  await expect(page.getByRole("alert")).toHaveText(settingsCopy.staff.errors.already_listed);
  await expect(page.getByRole("group", { name: review.title })).toHaveCount(0);
});

test("says why a change was refused", async ({ page }) => {
  await open(page, { "POST /api/staff": fails(409, "last_admin") });
  await page.getByRole("button", { name: "Change owner@maneman.in" }).click();
  await page.getByLabel(settingsCopy.suppliers.active).uncheck();
  await page.getByRole("group", { name: "Change owner@maneman.in" }).getByRole("button", { name: review.next }).click();
  const check = page.getByRole("group", { name: review.title });
  await expect(check).toContainText(settingsCopy.staff.confirm.switchesOff);
  await check.getByRole("button", { name: review.send }).click();
  await expect(page.getByRole("alert")).toHaveText(settingsCopy.staff.errors.last_admin);
});

test("starts enforcing only after the check, for someone who may switch it", async ({ page }) => {
  const enforced = { ...BOOK, enforced: { on: true, set_by: "owner@maneman.in", set_at: AT } };
  await open(page, { "POST /api/staff/enforcement": json(enforced) });
  await page.getByRole("button", { name: settingsCopy.staff.enforcement.start }).click();
  const check = page.getByRole("group", { name: settingsCopy.staff.enforcement.startTitle });
  const request = posted(page, "/api/staff/enforcement");
  await check.getByRole("button", { name: review.send }).click();
  expect((await request).postDataJSON()).toEqual({ on: true });
  await expect(page.getByRole("button", { name: settingsCopy.staff.enforcement.stop })).toBeVisible();
});

test("offers the switch and the service tokens to nobody without Admin · Manage nationally", async ({ page }) => {
  await open(page, { "GET /api/staff": json({ ...BOOK, may_run_access: false }) });
  await expect(page.getByRole("button", { name: settingsCopy.staff.enforcement.start })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: settingsCopy.staff.tokens.addTitle })).toHaveCount(0);
});

/** Signed in as `email`, who may read the list, change it and take people off it. */
const signedInAs = (email: string) =>
  json({
    signed_in_as: email,
    sign_out: null,
    staff: {
      enforced: false,
      listed: true,
      grants: [],
      may_call: ["GET /api/staff", "POST /api/staff", "POST /api/staff/delete"],
    },
  });

test("removes a person from staff, once asked", async ({ page }) => {
  const left = { ...BOOK, people: BOOK.people.filter((each) => each.email !== "noida.lead@maneman.in") };
  await open(page, { "GET /api/whoami": signedInAs("owner@maneman.in"), "POST /api/staff/delete": json(left) });
  await page.getByRole("button", { name: "Change noida.lead@maneman.in" }).click();
  await page.getByRole("button", { name: "Remove noida.lead@maneman.in" }).click();
  await expect(page.getByText("Remove noida.lead@maneman.in from staff?")).toBeVisible();

  const sent = posted(page, "/api/staff/delete");
  await page.getByRole("button", { name: settingsCopy.jobSheet.removeButton, exact: true }).click();
  expect((await sent).postDataJSON()).toEqual({ email: "noida.lead@maneman.in" });
  await expect(page.getByRole("status").filter({ hasText: settingsCopy.staff.removed })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "noida.lead@maneman.in" })).toHaveCount(0);
});

test("offers nobody a way to remove themselves", async ({ page }) => {
  await open(page, { "GET /api/whoami": signedInAs("owner@maneman.in") });
  await page.getByRole("button", { name: "Change owner@maneman.in" }).click();
  await expect(page.getByRole("button", { name: "Remove owner@maneman.in" })).toHaveCount(0);
});

test("meets WCAG 2.2 AA, a box to a line", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: settingsCopy.staff.add }).click();
  await expectOneBoxALine(page, settingsCopy.staff.add);
  expect(await axeViolations(page)).toEqual([]);
});
