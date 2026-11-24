// Tasks written by hand on Tasks (docs/decisions/0302-tasks-written-by-hand.md): New task in the page's head opens the
// panel a task is written in, for a department, about a client found by name, due when chosen, and whose it is; a
// written task on the board is marked done from its row. Every name and number here is made up.

import type { Page, Request, Route } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { empty, fails, json, TASKS, type OpsReply } from "./fixtures.ts";
import { detail, open, row } from "./tasks-fixtures.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";

const copy = opsCopy.tasks.write;
const WRITTEN = "aa000000-0000-4000-8000-000000000001";
const ROHIT = { id: "22000000-0000-4000-8000-000000000007", name: "Rohit Malhotra", mobile: "+91 98100 04417" };

const FOUND = {
  clients: [{ ...ROHIT, stage: "active", next_visit: null, under_way: false }],
  more: false,
} satisfies OpsReply<"/api/clients/find", "post">;

/** The board with one task written by hand for Customer Care. */
const WITH_WRITTEN = {
  ...TASKS,
  groups: [
    ...TASKS.groups,
    {
      group: "staff_task_customer_care",
      count: 1,
      closable: false,
      snoozable: true,
      tasks: [
        {
          id: WRITTEN,
          person: { id: ROHIT.id, name: ROHIT.name },
          detail: "Call back about the evening slot",
          facts: { group: "staff_task_customer_care" },
          since: "2027-09-20T11:30:00.000Z",
          due: "2027-09-20T11:30:00.000Z",
          owner: null,
        },
      ],
    },
  ],
} satisfies OpsReply<"/api/tasks">;

/** The written task's panel, which its client heads and its words follow. */
async function writtenPanel(page: Page) {
  await detail(page, "Call back about the evening slot");
  const panel = page.getByRole("dialog", { name: ROHIT.name });
  await expect(panel).toContainText("Call back about the evening slot");
  return panel;
}

test("writes a task for a department about a client found by name, due when chosen, and says it was added", async ({
  page,
}) => {
  const written: Request[] = [];
  await open(page, TASKS, undefined, {
    "POST /api/clients/find": json(FOUND),
    "POST /api/tasks": (route) => {
      written.push(route.request());
      return json({ id: WRITTEN }, 201)(route);
    },
  });
  await page.getByRole("button", { name: copy.open }).click();
  const panel = page.getByRole("dialog", { name: copy.title });
  await panel.getByLabel(copy.what, { exact: true }).fill("Call back about the evening slot");
  await panel.getByLabel(copy.department, { exact: true }).selectOption("customer_care");
  await panel.getByLabel(copy.client, { exact: true }).fill("Rohit");
  await panel.getByRole("button", { name: copy.find }).click();
  await panel.getByRole("button", { name: copy.chooseLabel(ROHIT.name) }).click();
  await expect(panel).toContainText(copy.chosen(ROHIT.name, ROHIT.mobile));
  await panel.getByLabel(copy.day, { exact: true }).fill("2027-09-21");
  await panel.getByLabel(copy.time, { exact: true }).fill("17:00");
  expect(await axeViolations(page)).toEqual([]);
  await panel.getByRole("button", { name: copy.add }).click();

  await expect(page.getByText(copy.added)).toBeVisible();
  await expect(panel).toHaveCount(0);
  expect(written.map((request) => request.postDataJSON() as unknown)).toEqual([
    {
      what: "Call back about the evening slot",
      department: "customer_care",
      client: ROHIT.id,
      city: null,
      due: "2027-09-21T11:30:00.000Z",
      owner: null,
    },
  ]);
});

test("says under its box why a task was refused, and keeps the panel open", async ({ page }) => {
  await open(page, TASKS, undefined, { "POST /api/tasks": fails(400, "invalid_request", ["due"]) });
  await page.getByRole("button", { name: copy.open }).click();
  const panel = page.getByRole("dialog", { name: copy.title });
  await panel.getByLabel(copy.what, { exact: true }).fill("Check the kit count");
  await panel.getByRole("button", { name: copy.add }).click();
  await expect(panel.getByText(copy.errors.due).first()).toBeVisible();
  await expect(panel).toBeVisible();
});

test("marks a task written by hand done from its row, which leaves the board", async ({ page }) => {
  const done: string[] = [];
  await open(page, WITH_WRITTEN, undefined, {
    [`POST /api/tasks/staff/${WRITTEN}/done`]: (route) => {
      done.push(route.request().url());
      return empty()(route);
    },
  });
  const written = row(page, "Call back about the evening slot");
  await expect(written).toContainText(opsCopy.tasks.groups.staff_task_customer_care);
  await written.getByRole("button", { name: copy.doneLabel("Call back about the evening slot") }).click();
  await expect(written).toHaveCount(0);
  expect(done).toHaveLength(1);
});

// A task snoozed until the morning (docs/decisions/0303-snoozing-a-task.md): it leaves the list, and the page says so.
test("snoozes a task from its panel until tomorrow morning, which leaves the list", async ({ page }) => {
  const [replacements] = TASKS.groups;
  const kunal = replacements?.tasks.find((task) => task.person.name === "Kunal Mehta");
  if (replacements === undefined || kunal === undefined) throw new Error("the board has no task for Kunal Mehta");
  const snoozed: string[] = [];
  await open(page, TASKS, undefined, {
    [`POST /api/tasks/${replacements.group}/${kunal.id}/snooze`]: (route: Route) => {
      snoozed.push(route.request().url());
      return json({ until: "2027-09-21T04:30:00.000Z" })(route);
    },
  });
  const panel = await detail(page, "Kunal Mehta");
  await panel.getByRole("button", { name: opsCopy.tasks.snooze.button }).click();
  // Until the moment the API says, in the console's words: 10 am on Tuesday the 21st, in India.
  await expect(page.getByText(opsCopy.tasks.snooze.done("Tue 21 Sep, 10 am"))).toBeVisible();
  await expect(row(page, "Kunal Mehta")).toHaveCount(0);
  expect(snoozed).toHaveLength(1);
});

test("searches for a client on Enter in its box, rather than adding the task without them", async ({ page }) => {
  const written: Request[] = [];
  await open(page, TASKS, undefined, {
    "POST /api/clients/find": json(FOUND),
    "POST /api/tasks": (route) => {
      written.push(route.request());
      return json({ id: WRITTEN }, 201)(route);
    },
  });
  await page.getByRole("button", { name: copy.open }).click();
  const panel = page.getByRole("dialog", { name: copy.title });
  await panel.getByLabel(copy.what, { exact: true }).fill("Call back about the evening slot");
  await panel.getByLabel(copy.client, { exact: true }).fill("Rohit");
  await panel.getByLabel(copy.client, { exact: true }).press("Enter");
  await expect(panel.getByRole("button", { name: copy.chooseLabel(ROHIT.name) })).toBeVisible();
  expect(written).toEqual([]);
  // Chosen, the keyboard is on Change, which takes the place of the button pressed.
  await panel.getByRole("button", { name: copy.chooseLabel(ROHIT.name) }).click();
  await expect(panel.getByRole("button", { name: copy.change })).toBeFocused();
});

test("reads the board again once a task is added", async ({ page }) => {
  let reads = 0;
  page.on("request", (request) => {
    if (request.method() === "GET" && new URL(request.url()).pathname === "/api/tasks") reads += 1;
  });
  await open(page, TASKS, undefined, { "POST /api/tasks": json({ id: WRITTEN }, 201) });
  const before = reads;
  await page.getByRole("button", { name: copy.open }).click();
  const panel = page.getByRole("dialog", { name: copy.title });
  await panel.getByLabel(copy.what, { exact: true }).fill("Check the kit count");
  await panel.getByRole("button", { name: copy.add }).click();
  await expect(page.getByText(copy.added)).toBeVisible();
  await expect.poll(() => reads).toBeGreaterThan(before);
});

// Someone in Finance with View alone: they may write a task, but not look clients up, nor finish or snooze Care's.
test("offers no client search, and no Mark done or Snooze, where the person's access does not reach them", async ({
  page,
}) => {
  await open(page, WITH_WRITTEN, undefined, {
    "GET /api/whoami": json({
      signed_in_as: "finance@maneman.in",
      sign_out: "/cdn-cgi/access/logout",
      cities: [],
      every_city: true,
      staff: {
        enforced: true,
        listed: true,
        grants: [{ department: "finance", level: "view", geography: "national", place: null }],
        may_call: ["GET /api/health", "GET /api/whoami", "GET /api/tasks", "GET /api/alerts", "POST /api/tasks"],
      },
    } satisfies OpsReply<"/api/whoami">),
  });
  const written = row(page, "Call back about the evening slot");
  await expect(written).toBeVisible();
  await expect(written.getByRole("button", { name: /^Mark done/ })).toHaveCount(0);
  const panel = await writtenPanel(page);
  await expect(panel.getByRole("button", { name: opsCopy.tasks.snooze.button })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /^Mark done/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: copy.open }).click();
  const writing = page.getByRole("dialog", { name: copy.title });
  await expect(writing.getByLabel(copy.what, { exact: true })).toBeVisible();
  await expect(writing.getByLabel(copy.client, { exact: true })).toHaveCount(0);
});

// Someone whose work reaches Gurgaon and Delhi alone, with All cities in the header: a task about nobody needs a city.
test("asks a city of a task about nobody where the person's cities are some alone, and says when it is refused", async ({
  page,
}) => {
  const written: Request[] = [];
  await open(page, TASKS, undefined, {
    "GET /api/whoami": json({
      signed_in_as: "city.head@maneman.in",
      sign_out: "/cdn-cgi/access/logout",
      cities: ["Gurgaon", "Delhi"],
      every_city: false,
      staff: {
        enforced: true,
        listed: true,
        grants: [{ department: "operations", level: "act", geography: "city", place: "Gurgaon" }],
        may_call: ["GET /api/health", "GET /api/whoami", "GET /api/tasks", "GET /api/alerts", "POST /api/tasks"],
      },
    } satisfies OpsReply<"/api/whoami">),
    "POST /api/tasks": (route) => {
      written.push(route.request());
      return fails(400, "invalid_request", ["city"])(route);
    },
  });
  await page.getByRole("button", { name: copy.open }).click();
  const panel = page.getByRole("dialog", { name: copy.title });
  await panel.getByLabel(copy.what, { exact: true }).fill("Count the kit at the Gurgaon store");
  const city = panel.getByLabel(copy.city, { exact: true });
  await expect(city).toBeVisible();
  await city.selectOption("Gurgaon");
  await panel.getByRole("button", { name: copy.add }).click();
  await expect(panel.getByText(copy.errors.city).first()).toBeVisible();
  expect(written.map((request) => (request.postDataJSON() as { city: string | null }).city)).toEqual(["Gurgaon"]);
});

test("says how to search when too little is typed, and when the search itself fails", async ({ page }) => {
  const searched: Request[] = [];
  await open(page, TASKS, undefined, {
    "POST /api/clients/find": (route) => {
      searched.push(route.request());
      return fails(503, "unavailable")(route);
    },
  });
  await page.getByRole("button", { name: copy.open }).click();
  const panel = page.getByRole("dialog", { name: copy.title });
  const box = panel.getByLabel(copy.client, { exact: true });
  await box.fill("R");
  await box.press("Enter");
  await expect(panel.getByText(copy.tooShort)).toBeVisible();
  expect(searched).toEqual([]);
  await box.fill("Rohit");
  await panel.getByRole("button", { name: copy.find, exact: true }).click();
  await expect(panel.getByText(copy.searchFailed)).toBeVisible();
  expect(searched).toHaveLength(1);
});

test("names a written task about nobody as for no client, in its row and its panel", async ({ page }) => {
  const [written] = WITH_WRITTEN.groups.at(-1)?.tasks ?? [];
  if (written === undefined) throw new Error("the board has no written task");
  const nobody = {
    ...WITH_WRITTEN,
    groups: [...TASKS.groups, { ...WITH_WRITTEN.groups.at(-1), tasks: [{ ...written, person: null }] }],
  } as unknown as OpsReply<"/api/tasks">;
  await open(page, nobody);
  await expect(row(page, "Call back about the evening slot")).toContainText(copy.noClient);
  await detail(page, "Call back about the evening slot");
  await expect(page.getByRole("dialog", { name: copy.noClient })).toBeVisible();
});

test("says why a written task could not be snoozed, and that one done or gone meanwhile is so", async ({ page }) => {
  await open(page, WITH_WRITTEN, undefined, {
    [`POST /api/tasks/staff/${WRITTEN}/done`]: fails(404, "not_found"),
    [`POST /api/tasks/staff_task_customer_care/${WRITTEN}/snooze`]: fails(403, "not_permitted"),
  });
  const panel = await writtenPanel(page);
  await panel.getByRole("button", { name: opsCopy.tasks.snooze.button }).click();
  await expect(panel.getByText(opsCopy.tasks.snooze.errors.not_permitted)).toBeVisible();
  // Done or gone since the board was read: the panel closes on the board read again, which says so.
  await panel.getByRole("button", { name: /^Mark done/ }).click();
  await expect(page.getByText(copy.errors.not_found).first()).toBeVisible();
  await expect(panel).toHaveCount(0);
});
