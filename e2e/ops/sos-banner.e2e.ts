// A technician's SOS on the console (docs/decisions/0248-safety.md): a red banner over whichever screen is open, with
// whose it is, the visit, when, a map and whether they said they are safe, until Operations mark it handled. Every
// name and place is made up.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, empty, json, type OpsReply } from "./fixtures.ts";
import { shell } from "../../apps/ops/src/content/shell.ts";

const SOS: OpsReply<"/api/sos">["open"][number] = {
  id: "5e000000-0000-4000-8000-000000000001",
  technician: { name: "Imran Qureshi" },
  visit: {
    starts_at: "2026-09-21T06:00:00.000Z",
    client_name: "Rohit Malhotra",
  },
  position: { lat: 28.3988, lng: 77.07, at: "2026-09-21T06:41:00.000Z" },
  sent_at: "2026-09-21T06:41:00.000Z",
  safe_at: null,
};

test("an SOS shows over every screen, with whose it is, the visit and a map, until it is marked handled", async ({
  page,
}) => {
  let open = [SOS];
  await answer(page, {
    "GET /api/sos": (route) => json({ open })(route),
    "POST /api/sos/{id}/handled": (route) => {
      open = [];
      return empty()(route);
    },
  });
  await page.goto("/settings/cities");

  const banner = page.getByRole("alert").filter({ hasText: shell.sos.title("Imran Qureshi", "12:11 pm") });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(shell.sos.visit("Rohit Malhotra", "11:30 am"));
  await expect(banner).toContainText(shell.sos.call);
  await expect(banner.getByRole("link", { name: shell.sos.map("12:11 pm") })).toHaveAttribute(
    "href",
    "https://www.google.com/maps?q=28.39880,77.07000",
  );
  expect(await axeViolations(page)).toEqual([]);

  await banner.getByRole("button", { name: shell.sos.handled }).click();
  await expect(banner).toHaveCount(0);
});

test("says when the technician said they are safe", async ({ page }) => {
  await answer(page, { "GET /api/sos": json({ open: [{ ...SOS, safe_at: "2026-09-21T06:45:00.000Z" }] }) });
  await page.goto("/settings/cities");
  await expect(page.getByRole("alert").filter({ hasText: shell.sos.safe("12:15 pm") })).toBeVisible();
});
