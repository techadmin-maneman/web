// Settings · Booking's "Times offered to clients" (docs/decisions/0293-steering-booking-times.md): how many of a day's
// times the app marks Recommended, and how much more driving than the day's best a time offered to clients may add.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { json, SETTINGS } from "./fixtures.ts";
import { open } from "./settings-fixtures.ts";
import { EDITING } from "../../apps/ops/src/content/common.ts";
import { settings as copy } from "../../apps/ops/src/content/settings.ts";

const STEERING = {
  name: "steering",
  kind: "number",
  title: "Times offered to clients",
  note: "The times that add least driving are marked Recommended in the app.",
  unit: "minutes",
  min: 0,
  max: 240,
  keys: ["recommended", "drive_cap"],
  bounds: {
    recommended: { min: 0, max: 10, unit: "times a day" },
    drive_cap: { min: 5, max: 240, unit: "minutes beyond the day’s best" },
  },
  value: { recommended: 3, drive_cap: 30 },
  default: { recommended: 3, drive_cap: 30 },
  set_by: null,
  set_at: null,
} as const;

test("shows the times offered to clients under Booking, each figure with its own unit, and passes axe", async ({
  page,
}) => {
  await open(page, "/settings/booking", {
    "GET /api/settings": json({ ...SETTINGS, settings: [...SETTINGS.settings, STEERING] }),
  });
  const group = page.getByRole("group", { name: STEERING.title });
  const labels = copy.rules.keyNames.steering;
  expect(labels).toBeDefined();
  // Each figure is its own Change, read with its unit.
  const change = (label: string) => group.getByRole("button", { name: `${EDITING.change} ${label}`, exact: true });
  await expect(change(labels?.recommended ?? "")).toContainText("3 times a day");
  await expect(change(labels?.drive_cap ?? "")).toContainText("30 minutes beyond the day’s best");
  expect(await axeViolations(page)).toEqual([]);
});
