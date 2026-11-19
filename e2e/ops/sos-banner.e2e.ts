// A technician's SOS on the console (docs/decisions/0248-safety.md): a red banner over whichever screen is open, with
// whose it is, the visit, when, a map and whether they said they are safe, until Operations mark it handled. Every
// name and place is made up.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, empty, fails, json, type OpsReply } from "./fixtures.ts";
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

// The console's access is everything until whoami answers, so the banner waits for it, and asks nothing of one
// the Staff list does not let read SOS.
test("asks nothing of the API for one not let read SOS, however late whoami answers", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/sos") asked.push(request.url());
  });
  await answer(page, {
    "GET /api/whoami": async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      return json({
        signed_in_as: "money@maneman.in",
        sign_out: null,
        staff: { enforced: true, listed: true, grants: [], may_call: ["GET /api/health", "GET /api/whoami"] },
        cities: [],
        every_city: true,
      })(route);
    },
    "GET /api/sos": json({ open: [SOS] }),
  });
  await page.goto("/settings/cities");
  await expect(page.getByRole("main")).toBeVisible();
  await page.waitForTimeout(1500);
  expect(asked).toEqual([]);
  await expect(page.getByRole("alert").filter({ hasText: "Imran Qureshi" })).toHaveCount(0);
});

// An SOS must reach Operations however whoami fares: where it fails, the banner reads as it always did.
test("shows an SOS where whoami failed", async ({ page }) => {
  await answer(page, {
    "GET /api/whoami": fails(500, "internal_error"),
    "GET /api/sos": json({ open: [SOS] }),
  });
  await page.goto("/settings/cities");
  await expect(page.getByRole("alert").filter({ hasText: shell.sos.title("Imran Qureshi", "12:11 pm") })).toBeVisible();
});

test("names the visit by its time where its client has since been erased", async ({ page }) => {
  const erased = { ...SOS, visit: SOS.visit === null ? null : { ...SOS.visit, client_name: null } };
  await answer(page, { "GET /api/sos": json({ open: [erased] }) });
  await page.goto("/settings/cities");
  const banner = page.getByRole("alert").filter({ hasText: shell.sos.title("Imran Qureshi", "12:11 pm") });
  await expect(banner).toContainText(shell.sos.visit(null, "11:30 am"));
  await expect(banner).not.toContainText("’s visit");
});

test("says when the technician said they are safe", async ({ page }) => {
  await answer(page, { "GET /api/sos": json({ open: [{ ...SOS, safe_at: "2026-09-21T06:45:00.000Z" }] }) });
  await page.goto("/settings/cities");
  await expect(page.getByRole("alert").filter({ hasText: shell.sos.safe("12:15 pm") })).toBeVisible();
});
