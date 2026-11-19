// Tasks chosen together on the board (apps/ops/src/tasks/BulkActions.tsx, docs/decisions/0282-tasks-chosen-together.md):
// a box a row, a run with Shift, the head's box for every row shown; taken, assigned or closed in one go, each the
// API's own change; and the keys a desk moves by. Every name is made up.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { empty, fails, json, type OpsReply } from "./fixtures.ts";
import { open, rows } from "./tasks-fixtures.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";
import { tables } from "../../packages/ui/words.ts";

const PEOPLE = ["Manish Tandon", "Arjun Sood", "Kabir Anand"] as const;

/** Three visits left partly done, nobody's, which ops may take, assign or close. */
const BOARD: OpsReply<"/api/tasks"> = {
  overdue: 3,
  truncated: false,
  low_stock_places: 0,
  lapsed: 0,
  staff: ["ops@localhost", "anil@maneman.in"],
  groups: [
    {
      group: "partial_visit",
      count: 3,
      closable: true,
      tasks: PEOPLE.map((name, at) => ({
        id: `98000000-0000-4000-8000-00000000000${String(at + 1)}`,
        person: { id: `22000000-0000-4000-8000-00000000001${String(at + 1)}`, name },
        facts: {
          group: "partial_visit" as const,
          kind: "service",
          reason_code: "client_unwell",
          reason: "Client unwell",
          not_fitted: null,
          ask: null,
        },
        detail: "service Client unwell",
        since: "2027-09-18T06:00:00.000Z",
        due: `2027-09-2${String(at)}T06:00:00.000Z`,
        owner: null,
      })),
    },
  ],
};

const box = (page: Parameters<typeof rows>[0], name: string) =>
  page.getByRole("checkbox", { name: opsCopy.tasks.bulk.choose(opsCopy.tasks.groups.partial_visit, name) });

test("takes the tasks chosen, a run with Shift, each its own change, and counts what could not be", async ({
  page,
}) => {
  const owners: unknown[] = [];
  await open(page, BOARD, undefined, {
    "PUT /api/tasks/{group}/{id}/owner": async (route) => {
      const body = route.request().postDataJSON() as { owner: string };
      owners.push(body.owner);
      // The third was taken by someone else first.
      if (route.request().url().endsWith("00000000003/owner")) return fails(404, "not_found")(route);
      return json({ owner: body.owner })(route);
    },
  });
  await box(page, PEOPLE[0]).check();
  await box(page, PEOPLE[2]).click({ modifiers: ["Shift"] });
  await expect(page.getByText(tables.chosen(3))).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("button", { name: opsCopy.tasks.bulk.take(3) }).click();
  await expect(page.getByText(opsCopy.tasks.bulk.done(2, 1))).toBeVisible();
  expect(owners).toEqual(["ops@localhost", "ops@localhost", "ops@localhost"]);
  await expect(rows(page).filter({ hasText: PEOPLE[0] })).toContainText("Ops");
  await expect(box(page, PEOPLE[0])).not.toBeChecked();
});

test("assigns every row shown to one person, and closes them all with one reason", async ({ page }) => {
  const owners: unknown[] = [];
  const reasons: unknown[] = [];
  await open(page, BOARD, undefined, {
    "PUT /api/tasks/{group}/{id}/owner": async (route) => {
      const body = route.request().postDataJSON() as { owner: string };
      owners.push(body.owner);
      return json({ owner: body.owner })(route);
    },
    "POST /api/tasks/{group}/{id}/close": async (route) => {
      reasons.push(route.request().postDataJSON());
      return empty()(route);
    },
  });
  await page.getByRole("checkbox", { name: tables.chooseAll }).check();
  await page.getByLabel(opsCopy.tasks.bulk.assignTo).selectOption("anil@maneman.in");
  await page.getByRole("button", { name: opsCopy.tasks.bulk.assign(3) }).click();
  await expect(page.getByText(opsCopy.tasks.bulk.done(3, 0))).toBeVisible();
  expect(owners).toEqual(["anil@maneman.in", "anil@maneman.in", "anil@maneman.in"]);

  await page.getByRole("checkbox", { name: tables.chooseAll }).check();
  await page.getByLabel(opsCopy.tasks.close.label).fill("Moved away; no more visits.");
  await page.getByRole("button", { name: opsCopy.tasks.bulk.close(3) }).click();
  await expect(rows(page)).toHaveCount(0);
  expect(reasons).toEqual(Array.from({ length: 3 }, () => ({ reason: "Moved away; no more visits." })));
});

test("moves along the rows by j and k, chooses one by x, and opens one by Enter", async ({ page }) => {
  await open(page, BOARD);
  const name = (person: string) => rows(page).filter({ hasText: person }).getByRole("button").first();
  await name(PEOPLE[0]).focus();
  await page.keyboard.press("j");
  await expect(name(PEOPLE[1])).toBeFocused();
  await page.keyboard.press("x");
  await expect(box(page, PEOPLE[1])).toBeChecked();
  await expect(page.getByText(tables.chosen(1))).toBeVisible();
  await page.keyboard.press("ArrowUp");
  await expect(name(PEOPLE[0])).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: PEOPLE[0] })).toBeVisible();
});
