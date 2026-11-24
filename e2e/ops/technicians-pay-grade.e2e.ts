// A technician's pay grade, chosen when they are added and on their details, by those whose Finance access gives one;
// nobody else sees it (docs/decisions/0307-the-people-rulings.md). Every name and number here is made up.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import {
  answer,
  BOARD,
  fails,
  json,
  TASKS_READ_ON,
  TECHNICIAN_ADDED,
  TECHNICIAN_WORK,
  TECHNICIANS,
  type Answers,
  type Call,
  type OpsReply,
} from "./fixtures.ts";
import { IMRAN, READ_ROSTER, READ_WORK, pageOf } from "./technicians-fixtures.ts";
import { EDITING } from "../../apps/ops/src/content/common.ts";
import { states } from "../../packages/ui/words.ts";
import { ROUTE_NEEDS } from "../../src/policy/console-routes.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";

const words = opsCopy.technicians.payGrade;
const add = opsCopy.technicians.add;
const SENIOR = "9a000000-0000-4000-8000-000000000001";

const PAY: OpsReply<"/api/technician-pay"> = {
  today: "2026-09-21",
  kinds: ["service"],
  cities: ["Gurgaon"],
  max_amount: 1000000,
  grades: [{ id: SENIOR, name: "Senior", technicians: 0 }],
  technicians: [{ id: IMRAN, name: "Imran Qureshi", city: "Gurgaon", grade_id: null }],
  rates: [],
  rate_history: [],
  grade_history: [],
};

const ADD: Call = "POST /api/technicians";
const gradeOf = (id: string): Call => `POST /api/technician-pay/technicians/${id}`;

/** Someone who may run the roster but not give grades: every call but Technician pay's. */
const NO_FINANCE = json({
  signed_in_as: "ops@localhost",
  sign_out: null,
  staff: {
    enforced: true,
    listed: true,
    grants: [{ department: "operations", level: "manage", geography: "national", place: null }],
    may_call: Object.keys(ROUTE_NEEDS).filter((call) => !call.includes("/api/technician-pay")),
  },
  cities: ["Gurgaon", "Noida"],
  every_city: true,
} satisfies OpsReply<"/api/whoami">);

async function openWith(page: Page, answers: Answers): Promise<void> {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, {
    [READ_ROSTER]: json(TECHNICIANS),
    [READ_WORK]: json(TECHNICIAN_WORK),
    "GET /api/dispatch": json(BOARD),
    "GET /api/technician-pay": json(PAY),
    ...answers,
  });
  await page.goto("/technicians");
  await expect(page.getByRole("heading", { level: 1, name: opsCopy.technicians.title })).toBeVisible();
}

async function addNaveen(page: Page) {
  await page.getByRole("button", { name: add.open }).click();
  const form = page.getByRole("dialog", { name: add.open });
  await form.getByRole("textbox", { name: opsCopy.technicians.fields.name }).fill("Naveen Rao");
  await form.getByRole("textbox", { name: opsCopy.technicians.fields.mobile }).fill("9810000007");
  return form;
}

test("gives a new technician the grade chosen, once they are added", async ({ page }) => {
  await openWith(page, { [ADD]: json(TECHNICIAN_ADDED, 201), [gradeOf(TECHNICIAN_ADDED.id)]: json(PAY) });
  const form = await addNaveen(page);
  await form.getByRole("combobox", { name: words.optional }).selectOption({ label: "Senior" });
  expect(await axeViolations(page)).toEqual([]);
  const graded = page.waitForRequest((request) => request.url().includes("/api/technician-pay/technicians/"));
  await form.getByRole("button", { name: add.save }).click();
  expect((await graded).postDataJSON()).toEqual({ grade_id: SENIOR });
  await expect(page.getByRole("status")).toContainText(add.added("Naveen Rao"));
});

// Not a toast, which goes: until the grade is given the technician is not paid, so it stays on the roster.
test("says in the page a grade that did not save, the technician added all the same", async ({ page }) => {
  await openWith(page, {
    [ADD]: json(TECHNICIAN_ADDED, 201),
    [gradeOf(TECHNICIAN_ADDED.id)]: fails(400, "invalid_request"),
  });
  const form = await addNaveen(page);
  await form.getByRole("combobox", { name: words.optional }).selectOption({ label: "Senior" });
  await form.getByRole("button", { name: add.save }).click();
  await expect(form).toBeHidden();
  // An alert in the page, where a toast would be a status that goes.
  await expect(page.getByRole("alert")).toHaveText(add.addedNoGrade("Naveen Rao"));
  await expect(page.getByRole("status").filter({ hasText: add.addedNoGrade("Naveen Rao") })).toHaveCount(0);
});

test("says where the grades did not load, and reads them again on Try again", async ({ page }) => {
  // Every read fails until the test says otherwise, whatever the console tries again by itself.
  let failing = true;
  await openWith(page, {
    "GET /api/technician-pay": (route) => (failing ? route.abort() : json(PAY)(route)),
  });
  const form = await addNaveen(page);
  await expect(form.getByText(words.failed)).toBeVisible();
  failing = false;
  await form.getByRole("button", { name: states.retry }).click();
  await expect(form.getByRole("combobox", { name: words.optional })).toBeEnabled();
});

test("changes a technician's grade on their details", async ({ page }) => {
  await openWith(page, {
    [gradeOf(IMRAN)]: json({ ...PAY, technicians: [{ ...PAY.technicians[0], grade_id: SENIOR }] }),
  });
  await pageOf(page, "Imran Qureshi");
  await page.getByRole("button", { name: opsCopy.technicians.head.edit }).click();
  const main = page.getByRole("dialog", { name: "Imran Qureshi" });
  const row = main.getByRole("button", { name: `${EDITING.change} ${words.label}` });
  await expect(row).toContainText(words.none);
  await row.click();
  await main.getByLabel(words.label).selectOption({ label: "Senior" });
  const graded = page.waitForRequest((request) => request.url().includes(`/api/technician-pay/technicians/${IMRAN}`));
  await main.getByRole("button", { name: EDITING.save }).click();
  expect((await graded).postDataJSON()).toEqual({ grade_id: SENIOR, from: PAY.today });
  await expect(row).toContainText("Senior");
});

test("shows no grade, and reads none, to someone whose access gives none", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/technician-pay")) asked.push(request.url());
  });
  await openWith(page, { "GET /api/whoami": NO_FINANCE });
  const form = await addNaveen(page);
  await expect(form.getByRole("textbox", { name: opsCopy.technicians.fields.name })).toBeVisible();
  await expect(form.getByRole("combobox", { name: words.optional })).toHaveCount(0);
  expect(asked).toEqual([]);
});
