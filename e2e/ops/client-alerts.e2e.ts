// A client's alerts for the technicians: what every technician reads in red before they start, raised by Care on the
// client's page, each with who raised it and when, a technician's at a visit with theirs, and taken off where it
// stands (docs/decisions/0242-client-record.md).

import type { Route } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { CLIENT, fails, json, type OpsReply } from "./fixtures.ts";
import { openClient } from "./clients-fixtures.ts";
import { clients } from "../../apps/ops/src/content.ts";

const copy = clients.alerts;

type Alerts = OpsReply<"/api/clients/{id}/alerts">;

const FROM_A_VISIT = {
  id: "5b000000-0000-4000-8000-000000000001",
  body: "Dog at the gate.",
  written_at: "2027-09-18T05:00:00.000Z",
  raised_by: { kind: "technician" as const, name: "Imran" },
};

test("raises an alert for the technicians and takes it off, each saying who and when", async ({ page }) => {
  const sent: unknown[] = [];
  let alerts: Alerts = { alerts: [FROM_A_VISIT] };
  await openClient(page, `/clients/${CLIENT.id}`, {
    "GET /api/clients/{id}/alerts": (route: Route) => json(alerts)(route),
    "POST /api/clients/{id}/alerts": (route: Route) => {
      const raised = route.request().postDataJSON() as { body: string };
      sent.push(raised);
      alerts = {
        alerts: [
          {
            id: "5b000000-0000-4000-8000-000000000002",
            body: raised.body,
            written_at: "2027-09-20T05:00:00.000Z",
            raised_by: { kind: "staff", staff: "priya@maneman.in" },
          },
          FROM_A_VISIT,
        ],
      };
      return json(alerts, 201)(route);
    },
    "POST /api/clients/{id}/alerts/{alert_id}/take-off": (route: Route) => {
      alerts = { alerts: [FROM_A_VISIT] };
      return json(alerts)(route);
    },
  });
  const strip = page.getByRole("region", { name: copy.title });
  await expect(strip).toContainText(copy.by(copy.atVisit("Imran"), "18 Sep 2027"));
  await expect(strip.getByRole("button", { name: copy.save })).toHaveCount(0);
  await strip.getByLabel(copy.add).fill("Allergic to latex.");
  await strip.getByRole("button", { name: copy.save }).click();
  await expect(strip.getByRole("listitem")).toHaveText([/^Allergic to latex\./, /^Dog at the gate\./]);
  await expect(strip).toContainText(copy.by("Priya", "20 Sep 2027"));
  expect(await axeViolations(page)).toEqual([]);

  await strip.getByRole("button", { name: copy.takeOff }).first().click();
  await expect(strip.getByRole("listitem")).toHaveText([/^Dog at the gate\./]);
  expect(sent).toEqual([{ body: "Allergic to latex." }]);
});

test("says when an alert could not be taken off, and keeps it in the list", async ({ page }) => {
  await openClient(page, `/clients/${CLIENT.id}`, {
    "GET /api/clients/{id}/alerts": json({ alerts: [FROM_A_VISIT] }),
    "POST /api/clients/{id}/alerts/{alert_id}/take-off": fails(403, "not_permitted"),
  });
  const strip = page.getByRole("region", { name: copy.title });
  await strip.getByRole("button", { name: copy.takeOff }).click();
  await expect(strip.getByRole("alert")).toHaveText(copy.errors.not_permitted);
  await expect(strip.getByRole("listitem")).toHaveText([/^Dog at the gate\./]);
});
