// Clients lists every client beneath the search (GET /api/clients): the soonest next visit first, narrowed by where
// they stand and city, the narrowing kept in the address, a page at a time. Every name and number is made up.

import type { Request } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, json, type OpsReply } from "./fixtures.ts";

const ROHIT = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Rohit Malhotra",
  mobile: "+919810004417",
  state: "fitted" as const,
  city: "Gurgaon",
  next_visit: "2027-09-25T05:00:00.000Z",
};
const KABIR = {
  id: "11111111-1111-4111-8111-111111111113",
  name: "Kabir Suri",
  mobile: "+919810004418",
  state: "nothing_booked" as const,
  city: null,
  next_visit: null,
};
const LISTED = {
  clients: [ROHIT, KABIR],
  more: true,
  cities: ["Gurgaon", "Noida"],
} satisfies OpsReply<"/api/clients">;

const listed = (request: Request) => new URL(request.url()).pathname === "/api/clients";

test("lists every client beneath the search, narrowed by status and city, the narrowing kept in the address", async ({
  page,
}) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    if (listed(request)) asked.push(new URL(request.url()).search);
  });
  await answer(page, { "GET /api/clients": json(LISTED) });
  await page.goto("/clients");

  const list = page.getByRole("region", { name: "All clients" });
  await expect(list.getByRole("row")).toHaveCount(3);
  await expect(list.getByRole("row").nth(1)).toContainText("Rohit Malhotra");
  await expect(list.getByRole("row").nth(1)).toContainText("Sat 25 Sep");
  await expect(list.getByRole("row").nth(2)).toContainText("Not known");
  await expect(list.getByRole("row").nth(2)).toContainText("None booked");
  expect(await axeViolations(page)).toEqual([]);

  await list.getByLabel("Status").selectOption({ label: "Booked" });
  await expect.poll(() => asked.at(-1)).toBe("?state=lead");
  await list.getByLabel("City").selectOption("Noida");
  await expect.poll(() => asked.at(-1)).toBe("?state=lead&city=Noida");
  expect(new URL(page.url()).search).toBe("?state=lead&city=Noida");

  await list.getByRole("button", { name: "Next" }).click();
  await expect.poll(() => asked.at(-1)).toBe("?state=lead&city=Noida&page=1");
  await expect(list.getByText("Page 2")).toBeVisible();

  // The address opens the list narrowed as it was: a bookmark, or a link sent to a colleague.
  await page.reload();
  await expect(list.getByLabel("Status")).toHaveValue("lead");
  await expect(list.getByLabel("City")).toHaveValue("Noida");
});
