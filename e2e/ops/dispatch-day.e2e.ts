// The board's day on the road (ADR 0120): a column's routes, with the drive between each two visits and a drive longer
// than the gap called out, and a job in hand offered to the nearest technician's day first.

import { expect, test } from "../support.ts";
import { fails, json, ROOM, type OpsReply } from "./fixtures.ts";
import { open, press, READ_ROOM, ROHIT_BLOCK } from "./dispatch-fixtures.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";

const IMRAN = "66000000-0000-4000-8000-000000000001";
const SANDEEP = "66000000-0000-4000-8000-000000000002";
const FAIZAN = "66000000-0000-4000-8000-000000000004";
const [FIRST, SECOND, THIRD] = ["a1", "a2", "a3"].map((end) => `77000000-0000-4000-8000-0000000000${end}`);

const DAY = {
  date: "2025-09-19",
  city: null,
  drive_times: "shown",
  technicians: [
    {
      technician_id: IMRAN,
      name: "Imran Qureshi",
      initials: "IQ",
      colour: "1f6feb",
      stops: [
        {
          appointment_id: FIRST ?? "",
          starts_at: "2025-09-19T03:30:00.000Z",
          ends_at: "2025-09-19T05:00:00.000Z",
          window: "morning",
          type: "service",
          sector: "Sec 45",
          client: "Rohit M.",
          located: true,
        },
        {
          appointment_id: SECOND ?? "",
          starts_at: "2025-09-19T05:30:00.000Z",
          ends_at: "2025-09-19T07:00:00.000Z",
          window: "morning",
          type: "service",
          sector: "Sec 57",
          client: "Vikram S.",
          located: true,
        },
        {
          appointment_id: THIRD ?? "",
          starts_at: "2025-09-19T08:30:00.000Z",
          ends_at: "2025-09-19T10:00:00.000Z",
          window: "afternoon",
          type: "consultation",
          sector: "DLF 2",
          client: "Arjun R.",
          located: false,
        },
      ],
      legs: [{ from: FIRST ?? "", to: SECOND ?? "", minutes: 45, km: 12.3, gap_minutes: 30, fits: false }],
    },
  ],
} satisfies OpsReply<"/api/dispatch/day">;

const MAP = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#ddd"/></svg>`;

test("opens a day's routes from its column's head, and calls out a drive longer than the gap", async ({ page }) => {
  await open(page, {
    "GET /api/dispatch/day": json(DAY),
    "GET /api/dispatch/day/map": (route) => route.fulfill({ body: MAP, contentType: "image/svg+xml" }),
  });

  await press(page, "Routes for Fri 19");
  const routes = page.getByRole("dialog", { name: "Routes · Fri 19 Sep" });
  await expect(routes.getByRole("img", { name: "Map of each technician's route on Fri 19 Sep" })).toBeVisible();
  await expect(routes.getByRole("heading", { name: "Imran Qureshi" })).toBeVisible();
  await expect(routes).toContainText("45 min drive, 30 min gap");
  // A visit whose address has no pin is listed, with no drive to it.
  await expect(routes.getByRole("listitem").filter({ hasText: "DLF 2" })).toContainText(opsCopy.dispatch.routes.noPin);
});

test("says when drive times are off, and still lists the visits", async ({ page }) => {
  await open(page, {
    "GET /api/dispatch/day": json({ ...DAY, drive_times: "off", technicians: [{ ...DAY.technicians[0], legs: [] }] }),
    "GET /api/dispatch/day/map": fails(503, "unavailable"),
  });

  await press(page, "Routes for Fri 19");
  const routes = page.getByRole("dialog", { name: "Routes · Fri 19 Sep" });
  await expect(routes).toContainText(opsCopy.dispatch.routes.driveTimes.off);
  await expect(routes.getByRole("listitem")).toHaveCount(3);
  await expect(routes.getByRole("img")).toHaveCount(0);
});

test("offers a job in hand to the nearest technician's day first, with how far", async ({ page }) => {
  const near = {
    ...ROOM,
    rooms: ROOM.rooms.map((room) => {
      if (room.technician_id === SANDEEP && room.date === "2025-09-20") return { ...room, km: 2.4 };
      if (room.technician_id === FAIZAN && room.date === "2025-09-19") return { ...room, km: 8.1 };
      return room;
    }),
  };
  await open(page, { [READ_ROOM]: json(near) });

  await press(page, ROHIT_BLOCK);
  await press(page, "Move visit");
  const options = page.getByLabel(opsCopy.dispatch.landing.list).locator("option:not([disabled])");
  await expect(options.first()).toHaveText("Sandeep Yadav · Sat 20 Sep · morning · 2.4 km");
  await expect(options.nth(2)).toContainText("Faizan Ali · Fri 19 Sep");
  await expect(options.nth(2)).toContainText("8.1 km");
});
