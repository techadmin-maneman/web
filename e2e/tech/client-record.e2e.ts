// The client's record on the job's card and their history (docs/decisions/0242-client-record.md): the alerts every
// technician reads before they start, the note the last one left, and each earlier visit with its photographs.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { JOB_ID } from "./fixtures.ts";
import { fakeTech } from "./fake-tech.ts";
import * as techCopy from "../../apps/tech/src/content.ts";

const copy = techCopy.clientRecord;
const EARLIER = "22222222-2222-4222-8222-222222222299";
const PHOTO = "44444444-4444-4444-8444-444444444441";
const ALERT = "55555555-5555-4555-8555-555555555551";

test("puts the client's alerts and the last technician's note on the card, and opens their history", async ({
  page,
}) => {
  const fake = await fakeTech(page);
  fake.alerts = [
    {
      id: ALERT,
      body: "Allergic to latex.",
      raised_by: { kind: "staff" },
      written_at: "2026-09-02T05:00:00.000Z",
    },
  ];
  fake.handoff = {
    note: "Edge lifting at the left temple.",
    technician: "Imran",
    visit_id: EARLIER,
    date: "2026-09-01",
    photos: [{ angle: "front", url: `/api/tech/jobs/${JOB_ID}/history-photos/${PHOTO}` }],
  };
  await page.goto(`/jobs/${JOB_ID}`);

  await expect(page.getByRole("heading", { level: 2, name: copy.alerts })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Allergic to latex." })).toBeVisible();
  await expect(page.getByText("Edge lifting at the left temple.")).toBeVisible();
  await expect(page.getByText(copy.handoffBy("Imran", "1 Sep"))).toBeVisible();
  const photo = page.getByRole("img", { name: copy.photo("front") });
  await expect(photo).toBeVisible();
  expect(await photo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);

  await page.getByRole("link", { name: copy.history }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${JOB_ID}/history$`));
  await expect(page.getByRole("heading", { name: copy.title })).toBeFocused();
});

test("lists each earlier visit with who did it, how it closed, its note, photographs, what was used and the piece", async ({
  page,
}) => {
  const fake = await fakeTech(page);
  fake.history = {
    alerts: [
      {
        id: ALERT,
        body: "Allergic to latex.",
        raised_by: { kind: "technician", name: "Imran" },
        written_at: "2026-09-01T05:00:00.000Z",
      },
    ],
    visits: [
      {
        id: EARLIER,
        date: "2026-09-01",
        type: "service",
        technician: "Imran",
        result: "done",
        note: "Edge lifting at the left temple.",
        photos: [{ angle: "front", url: `/api/tech/jobs/${JOB_ID}/history-photos/${PHOTO}` }],
        consumables: [{ name: "Walker tape", quantity: 2 }],
        piece: "MM-0042",
      },
    ],
  };
  await page.goto(`/jobs/${JOB_ID}/history`);

  await expect(page.getByText("Allergic to latex.")).toBeVisible();
  await expect(page.getByText(copy.byAndResult("Imran", copy.results.done))).toBeVisible();
  await expect(page.getByText("Edge lifting at the left temple.")).toBeVisible();
  const photo = page.getByRole("img", { name: copy.photo("front") });
  await expect(photo).toBeVisible();
  expect(await photo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByText(`${copy.used}: Walker tape × 2`)).toBeVisible();
  await expect(page.getByText(copy.piece("MM-0042"))).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("button", { name: copy.back }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${JOB_ID}$`));
});

test("says when the client has no earlier visit", async ({ page }) => {
  await fakeTech(page);
  await page.goto(`/jobs/${JOB_ID}/history`);
  await expect(page.getByText(copy.none)).toBeVisible();
});
