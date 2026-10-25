// Admin · Staff: who may use the console and for what, the switch that enforces it, and the service tokens let
// in. A person's row opens their record, where whether they are let in and each grant's level change where they read
// (docs/decisions/0212-editing-in-place.md); a refusal is said in the page's own words.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, fails, json, type Answers, type OpsReply } from "./fixtures.ts";
import { settings as settingsCopy } from "../../apps/ops/src/content/settings.ts";
import { deleting, EDITING } from "../../apps/ops/src/content/common.ts";

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

const copy = settingsCopy.staff;

const row = (page: Page, email: string) =>
  page.getByRole("row").filter({ has: page.getByRole("button", { name: copy.open(email) }) });

async function recordOf(page: Page, email: string) {
  await page.getByRole("button", { name: copy.open(email) }).click();
  return page.getByRole("dialog", { name: email });
}

test("lists each person with their access and whether they are let in", async ({ page }) => {
  await open(page);
  await expect(page).toHaveTitle("Staff · Settings · Mane Man Ops");

  const owner = row(page, "owner@maneman.in");
  await expect(owner).toContainText("Admin · Manage · National");
  await expect(owner).toContainText("Finance · Manage · National");
  await expect(owner).toContainText(settingsCopy.suppliers.active);
  await expect(row(page, "noida.lead@maneman.in")).toContainText("Operations · Act · Noida");
  await expect(row(page, "noida.lead@maneman.in")).toContainText(settingsCopy.staff.inactive);
  await expect(page.getByText("a1b2c3d4.access")).toBeVisible();
});

test("adds a person with their first grant", async ({ page }) => {
  await open(page, { "POST /api/staff": json(BOOK) });
  await page.getByRole("button", { name: copy.add }).click();
  const form = page.getByRole("group", { name: copy.form.addTitle });
  await form.getByLabel(copy.form.email).fill("delhi.lead@maneman.in");
  await form.getByLabel(copy.form.department).selectOption("finance");
  await form.getByLabel(copy.form.level).selectOption("act");
  await form.getByLabel(copy.form.place).selectOption("city:Delhi");

  const request = posted(page, "/api/staff");
  await form.getByRole("button", { name: copy.form.add, exact: true }).click();
  expect((await request).postDataJSON()).toEqual({
    email: "delhi.lead@maneman.in",
    active: true,
    grants: [{ department: "finance", level: "act", geography: "city", place: "Delhi" }],
  });
  await expect(page.getByRole("status").filter({ hasText: copy.saved })).toBeVisible();
});

// The common jobs need two departments, granted one by one.
test("adds a person by their job, every grant it needs over the one place", async ({ page }) => {
  await open(page, { "POST /api/staff": json(BOOK) });
  await page.getByRole("button", { name: copy.add }).click();
  const form = page.getByRole("group", { name: copy.form.addTitle });
  await form.getByLabel(copy.form.email).fill("dispatch.delhi@maneman.in");
  await form.getByLabel(copy.form.role).selectOption({ label: copy.form.roles.dispatcher });
  await expect(form.getByRole("list", { name: copy.form.roles.dispatcher }).getByRole("listitem")).toHaveText([
    copy.form.roleGrant(copy.departments.operations, copy.levels.act),
    copy.form.roleGrant(copy.departments.customer_care, copy.levels.view),
  ]);
  await expect(form.getByLabel(copy.form.department)).toHaveCount(0);
  await form.getByLabel(copy.form.place).selectOption("city:Delhi");

  const request = posted(page, "/api/staff");
  await form.getByRole("button", { name: copy.form.add, exact: true }).click();
  expect((await request).postDataJSON()).toEqual({
    email: "dispatch.delhi@maneman.in",
    active: true,
    grants: [
      { department: "operations", level: "act", geography: "city", place: "Delhi" },
      { department: "customer_care", level: "view", geography: "city", place: "Delhi" },
    ],
  });
});

test("sends someone already listed to their record, rather than replacing their access unseen", async ({ page }) => {
  let sent = false;
  await open(page, {
    "POST /api/staff": (route) => {
      sent = true;
      return json(BOOK)(route);
    },
  });
  await page.getByRole("button", { name: copy.add }).click();
  const form = page.getByRole("group", { name: copy.form.addTitle });
  const email = form.getByLabel(copy.form.email);
  await email.fill("Owner@ManeMan.in");
  await expect(email).toHaveAccessibleDescription(copy.errors.already_listed);
  await form.getByRole("button", { name: copy.form.add, exact: true }).click();
  expect(sent).toBe(false);
});

test("changes a grant's level where it reads, the rest of their grants sent as they stand", async ({ page }) => {
  await open(page, { "POST /api/staff": json(BOOK) });
  const record = await recordOf(page, "owner@maneman.in");
  const finance = copy.grantLabel(copy.departments.finance, copy.national);
  await record.getByRole("button", { name: `${EDITING.change} ${finance}` }).click();
  await record.getByRole("combobox", { name: finance }).selectOption("view");
  const request = posted(page, "/api/staff");
  await record.getByRole("button", { name: EDITING.save }).click();
  expect((await request).postDataJSON()).toEqual({
    email: "owner@maneman.in",
    active: true,
    grants: [
      { department: "admin", level: "manage", geography: "national", place: null },
      { department: "finance", level: "view", geography: "national", place: null },
    ],
  });
});

test("takes a grant away by its level of none, and adds another department", async ({ page }) => {
  await open(page, { "POST /api/staff": json(BOOK) });
  const record = await recordOf(page, "owner@maneman.in");
  const finance = copy.grantLabel(copy.departments.finance, copy.national);
  await record.getByRole("button", { name: `${EDITING.change} ${finance}` }).click();
  await record.getByRole("combobox", { name: finance }).selectOption(copy.form.noAccess);
  let request = posted(page, "/api/staff");
  await record.getByRole("button", { name: EDITING.save }).click();
  expect((await request).postDataJSON()).toMatchObject({
    grants: [{ department: "admin", level: "manage", geography: "national", place: null }],
  });

  await record.getByRole("button", { name: copy.form.addGrant }).click();
  const add = record.getByRole("group", { name: copy.form.addGrant });
  await add.getByLabel(copy.form.department).selectOption("growth");
  request = posted(page, "/api/staff");
  await add.getByRole("button", { name: copy.form.add, exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({
    grants: [
      { department: "admin", level: "manage", geography: "national", place: null },
      { department: "finance", level: "manage", geography: "national", place: null },
      { department: "growth", level: "view", geography: "national", place: null },
    ],
  });
});

test("says why a change was refused", async ({ page }) => {
  await open(page, { "POST /api/staff": fails(409, "last_admin") });
  const record = await recordOf(page, "owner@maneman.in");
  await record.getByRole("button", { name: `${EDITING.change} ${copy.columns.state}` }).click();
  await record.getByRole("combobox", { name: copy.columns.state }).selectOption(copy.inactive);
  await record.getByRole("button", { name: EDITING.save }).click();
  await expect(record.getByRole("alert")).toHaveText(copy.errors.last_admin);
});

test("starts enforcing only once asked, for someone who may switch it", async ({ page }) => {
  const enforced = { ...BOOK, enforced: { on: true, set_by: "owner@maneman.in", set_at: AT } };
  await open(page, { "POST /api/staff/enforcement": json(enforced) });
  await page.getByRole("button", { name: copy.enforcement.starting.label() }).click();
  await expect(page.getByText(copy.enforcement.starting.warning())).toBeVisible();
  const request = posted(page, "/api/staff/enforcement");
  await page.getByRole("button", { name: copy.enforcement.starting.confirm, exact: true }).click();
  expect((await request).postDataJSON()).toEqual({ on: true });
  await expect(page.getByRole("button", { name: copy.enforcement.stopping.label() })).toBeVisible();

  // Turning it off reaches everyone: it looks dangerous, and waits for the word.
  await page.getByRole("button", { name: copy.enforcement.stopping.label() }).click();
  const off = page.getByRole("button", { name: copy.enforcement.stopping.confirm, exact: true });
  await expect(off).toBeDisabled();
  await page.getByRole("textbox", { name: deleting.typeToConfirm(copy.enforcement.typed) }).fill("off");
  await expect(off).toBeEnabled();
});

test("offers the switch and the service tokens to nobody without Admin · Manage nationally", async ({ page }) => {
  await open(page, { "GET /api/staff": json({ ...BOOK, may_run_access: false }) });
  await expect(page.getByRole("button", { name: copy.enforcement.starting.label() })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: copy.tokens.addTitle })).toHaveCount(0);
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
  const record = await recordOf(page, "noida.lead@maneman.in");
  await record.getByRole("button", { name: copy.removing.label("noida.lead@maneman.in") }).click();
  await expect(record.getByText(copy.removing.warning("noida.lead@maneman.in"))).toBeVisible();

  const sent = posted(page, "/api/staff/delete");
  await record.getByRole("button", { name: copy.removing.confirm, exact: true }).click();
  expect((await sent).postDataJSON()).toEqual({ email: "noida.lead@maneman.in" });
  await expect(page.getByRole("status").filter({ hasText: settingsCopy.staff.removed })).toBeVisible();
  await expect(row(page, "noida.lead@maneman.in")).toHaveCount(0);
});

test("offers nobody a way to remove themselves", async ({ page }) => {
  await open(page, { "GET /api/whoami": signedInAs("owner@maneman.in") });
  const record = await recordOf(page, "owner@maneman.in");
  await expect(record.getByRole("button", { name: copy.removing.label("owner@maneman.in") })).toHaveCount(0);
});

test("meets WCAG 2.2 AA, with a person's record open", async ({ page }) => {
  await open(page);
  await recordOf(page, "owner@maneman.in");
  expect(await axeViolations(page)).toEqual([]);
});
