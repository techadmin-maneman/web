// Clients lists every client beneath the search (GET /api/clients): the soonest next visit first, each at their stage,
// narrowed to a view and the header's city, the view kept in the address, a page at a time
// (docs/decisions/0307-the-people-rulings.md). Every name and number is made up.

import type { Request } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, chooseCity, json, signedInLocally, type OpsReply } from "./fixtures.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";

const words = opsCopy.clients.list;

const ROHIT = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Rohit Malhotra",
  mobile: "+919810004417",
  stage: "active" as const,
  city: "Gurgaon",
  next_visit: "2027-09-25T05:00:00.000Z",
  under_way: false,
  package: "Natural hair system",
  paid: 3540000,
};
const KABIR = {
  id: "11111111-1111-4111-8111-111111111113",
  name: "Kabir Suri",
  mobile: "+919810004418",
  stage: "consulted" as const,
  city: null,
  next_visit: null,
  under_way: false,
  package: null,
  paid: 0,
};
const LISTED = {
  clients: [ROHIT, KABIR],
  counts: { all: 62, lead: 60, booked: 1, fitted: 1, nothing_booked: 61, needs: 7 },
  next_cursor: "MQ",
  cities: ["Gurgaon", "Noida"],
} satisfies OpsReply<"/api/clients">;

const listed = (request: Request) => new URL(request.url()).pathname === "/api/clients";

test("lists every client beneath the search, narrowed to a view and the header's city, the view in the address", async ({
  page,
}) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    if (listed(request)) asked.push(new URL(request.url()).search);
  });
  await answer(page, { "GET /api/clients": json(LISTED), "GET /api/whoami": signedInLocally(["Gurgaon", "Noida"]) });
  await page.goto("/clients");

  const list = page.getByRole("region", { name: opsCopy.clients.title, exact: true });
  const views = page.getByRole("radiogroup", { name: words.view });
  await expect(list.getByRole("row")).toHaveCount(3);
  await expect(list.getByRole("row").nth(1)).toContainText("Rohit Malhotra");
  await expect(list.getByRole("row").nth(1)).toContainText("Sat 25 Sep");
  // Their stage, as a pill with their package beneath it, and what they have paid.
  const stage = list.getByRole("row").nth(1).getByRole("cell").nth(1);
  await expect(stage).toContainText(opsCopy.clients.stages.active);
  await expect(stage).toContainText("Natural hair system");
  await expect(list.getByRole("row").nth(1)).toContainText("Rs. 35,400");
  await expect(list.getByRole("row").nth(2).getByRole("cell").nth(1)).toContainText(opsCopy.clients.stages.consulted);
  // No city and no visit booked: each a gap, said aloud as None, never words of the list's own.
  await expect(list.getByRole("row").nth(2).getByRole("cell").nth(0)).toHaveText("—None");
  await expect(list.getByRole("row").nth(2).getByRole("cell").nth(2)).toHaveText("—None");
  // Each view carries how many it holds, those a task waits on too.
  await expect(views.getByRole("radio", { name: /^All/ })).toContainText("62");
  await expect(views.getByRole("radio", { name: new RegExp(`^${words.views.booked}`) })).toContainText("1");
  await expect(views.getByRole("radio", { name: new RegExp(`^${words.views.needs}`) })).toContainText("7");
  expect(await axeViolations(page)).toEqual([]);

  await views.getByRole("radio", { name: new RegExp(`^${words.views.lead}`) }).click();
  await expect.poll(() => asked.at(-1)).toBe("?view=lead");
  // The city is the header's, for every page (ADR 0225): the list starts again from its first page.
  await chooseCity(page, "Noida");
  await expect.poll(() => asked.at(-1)).toBe("?view=lead&city=Noida");
  expect(new URL(page.url()).search).toBe("?view=lead");

  await list.getByRole("button", { name: words.next }).click();
  await expect.poll(() => asked.at(-1)).toBe("?view=lead&city=Noida&cursor=MQ");
  await expect(list.getByText("51–52 of 60")).toBeVisible();

  // The address opens the list narrowed as it was: a bookmark, or a link sent to a colleague.
  await page.reload();
  await expect(views.getByRole("radio", { name: new RegExp(`^${words.views.lead}`) })).toBeChecked();
  await expect(page.getByRole("banner").getByRole("button", { name: opsCopy.shell.city.label("Noida") })).toBeVisible();
});

test("lists those a task waits on, and leaves out their count where the board was read only in part", async ({
  page,
}) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    if (listed(request)) asked.push(new URL(request.url()).search);
  });
  await answer(page, {
    "GET /api/clients": json({ ...LISTED, counts: { ...LISTED.counts, needs: null } }),
    "GET /api/whoami": signedInLocally(["Gurgaon"]),
  });
  await page.goto("/clients");
  const views = page.getByRole("radiogroup", { name: words.view });
  const needs = views.getByRole("radio", { name: new RegExp(`^${words.views.needs}`) });
  await expect(needs).toHaveText(words.views.needs);
  await needs.click();
  await expect.poll(() => asked.at(-1)).toBe("?view=needs");
});
