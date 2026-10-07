// Technicians: the roster, one row a technician, the jobs each has
// finished and how those ran; and each technician's own page, which the roster's
// names open: their details, then their week, leave, phones and kit, a tab at a time.
// The API is answered from e2e/ops/fixtures.ts, since a local database has no
// technician until one is added and none has logged in. The clock is fixed to
// the day the fixture's leave is read against.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import {
  answer,
  fails,
  json,
  RAVI,
  SWITCHED_OFF,
  TASKS_READ_ON,
  TECHNICIAN_ADDED,
  TECHNICIAN_WORK,
  TECHNICIANS,
  type Answer,
  type Answers,
  type Call,
  type OpsReply,
} from "./fixtures.ts";
import { IMRAN, READ_ROSTER, READ_WORK, pageOf, backToRoster } from "./technicians-fixtures.ts";

// ---- Adding, changing and switching off a technician ---------------------------------------------------------

const ADD: Call = "POST /api/technicians";

const CHANGE: Call = `PATCH /api/technicians/${IMRAN}`;

const SWITCH_OFF: Call = `POST /api/technicians/${IMRAN}/deactivate`;

const SWITCH_ON: Call = `POST /api/technicians/${RAVI.id}/reactivate`;

type Roster = OpsReply<"/api/technicians">;

/** The roster as the API holds it: a spec swaps `current` as a change would change the API's own rows. */
function rosterOf(initial: Roster): { readonly roster: { current: Roster }; readonly reply: Answer } {
  const roster = { current: initial };
  return { roster, reply: (route) => json(roster.current)(route) };
}

async function openWith(page: Page, answers: Answers, roster: Answer = json(TECHNICIANS)): Promise<void> {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { [READ_ROSTER]: roster, [READ_WORK]: json(TECHNICIAN_WORK), ...answers });
  await page.goto("/technicians");
  await expect(page.getByRole("heading", { level: 1, name: "Technicians" })).toBeVisible();
}

test("adds a technician, whose number signs in at once", async ({ page }) => {
  await openWith(page, { [ADD]: json(TECHNICIAN_ADDED, 201) });
  await page.getByRole("button", { name: "Add a technician" }).click();
  const form = page.getByRole("dialog", { name: "Add a technician" });

  await form.getByRole("textbox", { name: "Name" }).fill("Naveen Rao");
  await form.getByRole("textbox", { name: "Mobile" }).fill("+91 98100 00007");
  await form.getByRole("textbox", { name: "Zone (optional)" }).fill("Sec 66–80");
  await form.getByRole("combobox", { name: "City" }).selectOption("Noida");
  const sent = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/technicians"));
  await form.getByRole("button", { name: "Add technician" }).click();

  expect((await sent).postDataJSON()).toEqual({
    name: "Naveen Rao",
    mobile: "9810000007",
    zone: "Sec 66–80",
    city: "Noida",
  });
  await expect(form).toBeHidden();
  await expect(page.getByRole("status")).toContainText("Naveen Rao added. They can sign in now.");
  expect(await axeViolations(page)).toEqual([]);
});

test("refuses a number another active technician signs in with, and keeps what was typed", async ({ page }) => {
  await openWith(page, { [ADD]: fails(409, "number_in_use") });
  await page.getByRole("button", { name: "Add a technician" }).click();
  const form = page.getByRole("dialog", { name: "Add a technician" });
  await form.getByRole("textbox", { name: "Name" }).fill("Naveen Rao");
  await form.getByRole("textbox", { name: "Mobile" }).fill("98100 00001");
  await form.getByRole("button", { name: "Add technician" }).click();

  await expect(form.getByRole("alert")).toHaveText("Another active technician signs in with that number.");
  await expect(form.getByRole("textbox", { name: "Name" })).toHaveValue("Naveen Rao");
});

test("asks for a mobile it can read before it sends anything", async ({ page }) => {
  await openWith(page, {});
  await page.getByRole("button", { name: "Add a technician" }).click();
  const form = page.getByRole("dialog", { name: "Add a technician" });
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") sent.push(request.url());
  });
  await form.getByRole("textbox", { name: "Name" }).fill("Naveen Rao");
  await form.getByRole("textbox", { name: "Mobile" }).fill("12345");
  await form.getByRole("button", { name: "Add technician" }).click();

  await expect(form.getByRole("alert")).toHaveText("Enter a 10-digit Indian mobile.");
  expect(sent).toEqual([]);
});

test("changes a technician's details, sending only what changed", async ({ page }) => {
  const { roster, reply } = rosterOf(TECHNICIANS);
  await openWith(page, { [CHANGE]: json({ id: IMRAN }) }, reply);
  const main = await pageOf(page, "Imran Qureshi");
  await expect(main.getByText("+91 98100 00001")).toBeVisible();

  await main.getByRole("button", { name: "Edit Imran Qureshi's details" }).click();
  await main.getByRole("textbox", { name: "Zone (optional)" }).fill("Sec 1–39");
  const sent = page.waitForRequest((request) => request.method() === "PATCH");
  roster.current = {
    ...TECHNICIANS,
    technicians: TECHNICIANS.technicians.map((each) => (each.id === IMRAN ? { ...each, zone: "Sec 1–39" } : each)),
  };
  await main.getByRole("button", { name: "Save" }).click();

  expect((await sent).postDataJSON()).toEqual({ zone: "Sec 1–39" });
  await expect(main.getByRole("button", { name: "Save" })).toBeHidden();
  await backToRoster(page);
  await expect(page.getByRole("row").filter({ hasText: "Imran Qureshi" })).toContainText("Sec 1–39");
});

test("moves a technician to another city, or to none", async ({ page }) => {
  await openWith(page, { [CHANGE]: json({ id: IMRAN }) });
  const main = await pageOf(page, "Imran Qureshi");
  await expect(main.getByRole("definition").filter({ hasText: "Gurgaon" })).toBeVisible();

  await main.getByRole("button", { name: "Edit Imran Qureshi's details" }).click();
  const city = main.getByRole("combobox", { name: "City" });
  await expect(city).toHaveValue("Gurgaon");
  await city.selectOption("No city");
  const sent = page.waitForRequest((request) => request.method() === "PATCH");
  await main.getByRole("button", { name: "Save" }).click();

  expect((await sent).postDataJSON()).toEqual({ city: null });
});

test("switches a technician off only once asked, and lists the visits he no longer holds", async ({ page }) => {
  const { roster, reply } = rosterOf(TECHNICIANS);
  await openWith(page, { [SWITCH_OFF]: json(SWITCHED_OFF) }, reply);
  const main = await pageOf(page, "Imran Qureshi");

  await main.getByRole("button", { name: "Switch off Imran Qureshi" }).click();
  await expect(main.getByText("Signs them out. Upcoming visits go back to the dispatch board.")).toBeVisible();
  await main.getByRole("button", { name: "Cancel" }).click();
  await main.getByRole("button", { name: "Switch off Imran Qureshi" }).click();

  roster.current = {
    ...TECHNICIANS,
    technicians: TECHNICIANS.technicians.filter((each) => each.id !== IMRAN),
    switched_off: [{ id: IMRAN, name: "Imran Qureshi", zone: "Sec 40–65", city: "Gurgaon", mobile: "+919810000001" }],
  };
  await main.getByRole("button", { name: "Switch off" }).click();

  const returned = main.getByRole("status");
  await expect(returned).toContainText("2 visits are back on the dispatch board.");
  await expect(returned).toContainText("Fri 24 Sep, 10 am · Rohit Malhotra");
  await expect(returned).toContainText("No client");
  await expect(returned.getByRole("link", { name: "Reassign on the dispatch board" })).toHaveAttribute(
    "href",
    "/dispatch",
  );
  await expect(main.getByRole("button", { name: "Switch Imran Qureshi back on" })).toBeVisible();
  // Switched off, they have no phone signed in and no leave to record: their page is their details alone.
  await expect(main.getByRole("navigation", { name: /^Imran Qureshi:/ })).toBeHidden();
  expect(await axeViolations(page)).toEqual([]);

  // They are off the roster's table, and listed apart.
  await backToRoster(page);
  await expect(page.getByRole("row").filter({ hasText: "Imran Qureshi" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Off" })).toContainText("Imran Qureshi");
});

test("lists the technicians switched off apart, and switches one back on", async ({ page }) => {
  const { roster, reply } = rosterOf({ ...TECHNICIANS, switched_off: [RAVI] });
  await openWith(page, { [SWITCH_ON]: json({ active: true }) }, reply);
  const off = page.getByRole("region", { name: "Off" });
  await expect(off).toContainText("Ravi Kumar");
  await expect(page.getByRole("row").filter({ hasText: "Ravi Kumar" })).toHaveCount(0);

  const main = await pageOf(page, "Ravi Kumar");
  await expect(main.getByRole("navigation", { name: /^Ravi Kumar:/ })).toBeHidden();
  roster.current = {
    ...TECHNICIANS,
    technicians: [
      ...TECHNICIANS.technicians,
      { ...RAVI, initials: "RK", sign_in_stopped_at: null, devices: [], leave: [] },
    ],
    switched_off: [],
  };
  await main.getByRole("button", { name: "Switch Ravi Kumar back on" }).click();

  await expect(main.getByRole("status")).toContainText("Ravi Kumar can sign in again.");
  await expect(main.getByRole("navigation", { name: /^Ravi Kumar:/ })).toBeVisible();
  await backToRoster(page);
  await expect(off).toBeHidden();
  await expect(page.getByRole("row").filter({ hasText: "Ravi Kumar" })).toBeVisible();
});

test("says so when the number he signs in with is another's now", async ({ page }) => {
  await openWith(page, { [SWITCH_ON]: fails(409, "number_in_use") }, json({ ...TECHNICIANS, switched_off: [RAVI] }));
  const main = await pageOf(page, "Ravi Kumar");
  await main.getByRole("button", { name: "Switch Ravi Kumar back on" }).click();

  await expect(main.getByRole("alert")).toHaveText(
    "Another active technician now uses this number. Change one of them first.",
  );
});

test("says plainly when the person's access does not reach a switch", async ({ page }) => {
  await openWith(page, { [SWITCH_OFF]: fails(403, "not_permitted") });
  const main = await pageOf(page, "Imran Qureshi");
  await main.getByRole("button", { name: "Switch off Imran Qureshi" }).click();
  await main.getByRole("button", { name: "Switch off" }).click();

  await expect(main.getByRole("alert")).toHaveText("Your access doesn't include this. Ask an admin.");
});
