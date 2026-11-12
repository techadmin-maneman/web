// The technician's kit (docs/decisions/0164-the-kit-screen.md): opened from today, it shows what the kit holds with
// each lot's expiry, receives a top-up by the pieces scanned, and hands back returned pieces and expired stock; its
// writes need signal and say so without it.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fakeTech, type Fake } from "./fake-tech.ts";
import { writesTo } from "./steps-fixtures.ts";
import * as techCopy from "../../apps/tech/src/content.ts";
import { tab } from "./tabs.ts";

const copy = techCopy.kit;
const HAIR = "Mane Man Essential · 8 × 10 in · #1B · 20% grey · 120% density";

function withAKit(fake: Fake): void {
  fake.kit = {
    held: [
      {
        code: "solvent",
        name: "Solvent",
        unit: "ml",
        quantity: 120,
        low: false,
        ops_told: false,
        usable: 100,
        hair_system: false,
        lots: [
          { lot_code: "SV-1", expires_on: "2020-01-31", quantity: 20, use_first: false, recalled: false },
          { lot_code: "SV-2", expires_on: "2031-01-31", quantity: 60, use_first: false, recalled: false },
          { lot_code: "SV-3", expires_on: "2030-07-20", quantity: 40, use_first: true, recalled: false },
        ],
        units: [],
      },
    ],
    coming: [
      {
        id: "tr-1",
        code: "hs_exact",
        name: HAIR,
        unit: "piece",
        quantity: 2,
        from: "Gurgaon stockroom",
        sent_at: "2030-07-01T05:00:00.000Z",
        units: ["MM-ESS-0000007-H", "MM-ESS-0000008-J"],
      },
    ],
    returned: [{ piece_code: "MM-STD-4417-B", returned_at: "2030-07-01T05:00:00.000Z", reason: "Base lifting" }],
    forecast: [],
    visits: 0,
    pieces: [],
    asked: null,
  };
}

test("opens from its tab, shows each lot’s expiry, and receives a top-up by the pieces scanned", async ({ page }) => {
  const fake = await fakeTech(page);
  withAKit(fake);
  await page.goto("/");
  await tab(page, techCopy.tabs.kit).click();
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();

  const held = page.getByRole("region", { name: copy.held.title });
  // An expired lot goes back to ops, and is listed there rather than as held.
  await expect(page.getByRole("region", { name: copy.returned.title })).toContainText(/SV-1 · 20 ml\s*Expired 31 Jan/);
  await expect(held).not.toContainText("SV-1");
  await expect(held).toContainText("SV-2 · 60 ml · Expires 31 Jan");
  await expect(held).toContainText("SV-3 · 40 ml · Use first · expires 20 Jul");

  const coming = page.getByRole("region", { name: copy.coming.title });
  // Scan opens the camera; a label it can't read is typed in beside it.
  await coming.getByRole("button", { name: copy.scan.camera }).click();
  await coming.getByRole("button", { name: copy.scan.type }).click();
  const scan = coming.getByLabel(copy.scan.label);
  await scan.fill("mm-ess-0000007-h");
  await scan.press("Enter");
  await expect(coming).toContainText(copy.coming.scanned(1, 2));
  await scan.fill("MM-ESS-0000099-A");
  await scan.press("Enter");
  await expect(coming.getByRole("alert")).toHaveText(copy.coming.notOnIt);
  expect(await axeViolations(page)).toEqual([]);

  await expect(coming.getByRole("button", { name: copy.coming.reportMissing })).toBeEnabled();
  await coming.getByRole("button", { name: copy.coming.restToCome(1) }).click();
  await expect.poll(() => writesTo(fake, "transfers/tr-1/receive").length).toBe(1);
  expect(writesTo(fake, "transfers/tr-1/receive")[0]?.body).toEqual({
    units: ["MM-ESS-0000007-H"],
    rest: "on_its_way",
  });
});

test("receives a hair system once its last piece is scanned, and offers Receive again where that fails", async ({
  page,
}) => {
  const fake = await fakeTech(page);
  withAKit(fake);
  // The first receive is refused, with signal.
  let refused = true;
  await page.route("**/api/tech/kit/transfers/tr-1/receive", async (route) => {
    if (!refused) return route.fallback();
    refused = false;
    return route.fulfill({
      status: 400,
      json: { error: { code: "invalid_request", request_id: "kit-ref-3", fields: ["units"] } },
    });
  });
  await page.goto("/kit");
  const coming = page.getByRole("region", { name: copy.coming.title });
  await coming.getByRole("button", { name: copy.scan.camera }).click();
  await coming.getByRole("button", { name: copy.scan.type }).click();
  const scan = coming.getByLabel(copy.scan.label);
  for (const label of ["MM-ESS-0000007-H", "MM-ESS-0000008-J"]) {
    await scan.fill(label);
    await scan.press("Enter");
  }
  // The last piece in tries the receive; it did not go through, and Receive tries it again.
  await expect(coming.getByRole("alert")).toContainText(copy.notDone);
  await expect(coming.getByRole("button", { name: copy.coming.reportMissing })).toBeDisabled();
  await coming.getByRole("button", { name: copy.coming.receive, exact: true }).click();
  await expect.poll(() => writesTo(fake, "transfers/tr-1/receive").length).toBe(1);
  expect(writesTo(fake, "transfers/tr-1/receive")[0]?.body).toEqual({
    units: ["MM-ESS-0000007-H", "MM-ESS-0000008-J"],
    rest: "on_its_way",
  });
});

test("reports the pieces not scanned missing, with the ones that came", async ({ page }) => {
  const fake = await fakeTech(page);
  withAKit(fake);
  await page.goto("/kit");
  const coming = page.getByRole("region", { name: copy.coming.title });
  await expect(coming.getByRole("button", { name: copy.coming.reportMissing })).toBeDisabled();
  await coming.getByRole("button", { name: copy.scan.camera }).click();
  await coming.getByRole("button", { name: copy.scan.type }).click();
  await coming.getByLabel(copy.scan.label).fill("MM-ESS-0000008-J");
  await coming.getByLabel(copy.scan.label).press("Enter");
  await coming.getByRole("button", { name: copy.coming.reportMissing }).click();
  await expect.poll(() => writesTo(fake, "transfers/tr-1/receive").length).toBe(1);
  expect(writesTo(fake, "transfers/tr-1/receive")[0]?.body).toEqual({ units: ["MM-ESS-0000008-J"], rest: "missing" });
});

test("lists a recalled lot to hand back, not as held, and says low until it goes back", async ({ page }) => {
  const fake = await fakeTech(page);
  withAKit(fake);
  const [solvent] = fake.kit.held;
  if (solvent !== undefined) {
    fake.kit = {
      ...fake.kit,
      held: [
        {
          ...solvent,
          quantity: 12,
          usable: 2,
          low: true,
          ops_told: false,
          lots: [
            { lot_code: "SV-9", expires_on: "2031-01-31", quantity: 10, use_first: false, recalled: true },
            { lot_code: "SV-2", expires_on: "2031-01-31", quantity: 2, use_first: false, recalled: false },
          ],
        },
      ],
    };
  }
  await page.goto("/kit");
  const back = page.getByRole("region", { name: copy.returned.title });
  await expect(back.getByRole("listitem").filter({ hasText: "SV-9" })).toContainText(copy.held.recalled);
  await expect(back.getByRole("listitem").filter({ hasText: "SV-9" })).toContainText(copy.expired.recalledWord);
  const held = page.getByRole("region", { name: copy.held.title });
  await expect(held).not.toContainText("SV-9");
  await expect(held).toContainText(copy.held.lowUntilBack);
  // The figure is what is fit to use, not the 12 ml the kit's count holds.
  await expect(held.getByText("2 ml", { exact: true })).toBeVisible();
  await expect(held.getByText("12 ml", { exact: true })).toHaveCount(0);
});

// The kit read "Contour tape strip · -4 strips".
test("says an item is out, and how far short, rather than a count below nought", async ({ page }) => {
  const fake = await fakeTech(page);
  withAKit(fake);
  const [solvent] = fake.kit.held;
  if (solvent !== undefined) fake.kit = { ...fake.kit, held: [{ ...solvent, quantity: -4, usable: -4, lots: [] }] };
  await page.goto("/kit");
  const held = page.getByRole("region", { name: copy.held.title });
  await expect(held.getByRole("listitem")).toContainText(["Solvent" + copy.held.out("4 ml")]);
});

test("hands back the pieces that came off, and the expired stock", async ({ page }) => {
  const fake = await fakeTech(page);
  withAKit(fake);
  await page.goto("/kit");
  const back = page.getByRole("region", { name: copy.returned.title });
  await expect(back.getByRole("listitem").first()).toContainText("MM-STD-4417-B" + copy.returned.line("1 Jul"));
  await back.getByRole("button", { name: copy.returned.handBack(1) }).click();
  await back.getByRole("button", { name: copy.expired.handBack }).click();
  await expect.poll(() => writesTo(fake, "hand-back").length).toBe(2);
  expect(writesTo(fake, "hand-back").map((write) => write.body)).toEqual([
    { pieces: ["MM-STD-4417-B"], expired: false },
    { pieces: [], expired: true },
  ]);
});

test("hands back once for two taps, and says it did not go through with the reference to quote", async ({ page }) => {
  const fake = await fakeTech(page);
  withAKit(fake);
  let asked = 0;
  // Registered after the fake, so it answers first: slow enough for the second tap to land inside the first.
  await page.route("**/api/tech/kit/hand-back", async (route) => {
    asked += 1;
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "invalid_request", request_id: "kit-ref-1", fields: [] } }),
    });
  });
  await page.goto("/kit");
  const back = page.getByRole("region", { name: copy.returned.title });
  const hand = back.getByRole("button", { name: copy.returned.handBack(1) });
  await hand.click();
  // Forced, because the tap this guards against is one the technician makes whether the button takes it or not.
  await hand.click({ force: true });
  await expect(back.getByRole("alert")).toContainText(copy.notDone);
  await expect(back.getByRole("alert")).toContainText("kit-ref-");
  expect(asked).toBe(1);
  await expect(hand).toBeVisible();
});

test("says its writes need signal, with none", async ({ page, context }) => {
  const fake = await fakeTech(page);
  withAKit(fake);
  await page.goto("/kit");
  // The heading draws before the kit has loaded, so the signal goes only once the kit is on screen.
  await expect(page.getByRole("region", { name: copy.held.title })).toBeVisible();
  // No signal at all: the fake answers nothing either, as the network would not.
  fake.online = false;
  await context.setOffline(true);
  await expect(page.getByRole("button", { name: copy.needsSignal }).first()).toBeDisabled();
});

test("says nothing's short now where the API finds the kit short of nothing, and reads the kit again", async ({
  page,
}) => {
  const fake = await fakeTech(page);
  withAKit(fake);
  fake.kit = {
    ...fake.kit,
    forecast: [{ code: "shampoo", name: "Shampoo sachet", unit: "sachet", need: 6, have: 0 }],
  };
  await page.route("**/api/tech/kit/requests", async (route) => {
    // Meanwhile a top-up came: the week ahead is short of nothing.
    fake.kit = {
      ...fake.kit,
      forecast: [{ code: "shampoo", name: "Shampoo sachet", unit: "sachet", need: 6, have: 6 }],
    };
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "not_changeable", request_id: "kit-ref-2", fields: [] } }),
    });
  });
  await page.goto("/kit");
  const days = page.getByRole("region", { name: copy.forecast.title });
  await days.getByRole("button", { name: copy.forecast.requestOne("6 Shampoo sachets") }).click();
  await expect(days.getByRole("alert")).toHaveText(copy.forecast.nothingShort);
  await expect(days.getByRole("row", { name: /Shampoo sachet/ })).toContainText(copy.forecast.enough);
  await expect(days.getByRole("button", { name: copy.forecast.requestOne("6 Shampoo sachets") })).toHaveCount(0);
});

test("weighs the next seven days' need against the kit, a shortfall in red", async ({ page }) => {
  const fake = await fakeTech(page);
  withAKit(fake);
  fake.kit = {
    ...fake.kit,
    forecast: [
      { code: "shampoo", name: "Shampoo sachet", unit: "sachets", need: 6, have: 0 },
      { code: "solvent", name: "Solvent", unit: "ml", need: 80, have: 120 },
    ],
  };
  await page.goto("/kit");
  const days = page.getByRole("region", { name: copy.forecast.title });
  await expect(days.getByRole("row", { name: /Shampoo sachet/ })).toContainText(copy.forecast.short(6));
  await expect(days.getByRole("row", { name: /Solvent/ })).toContainText(copy.forecast.enough);
  expect(await axeViolations(page)).toEqual([]);

  // One tap asks ops for what is short; the kit then says when, until ops settle it.
  await days.getByRole("button", { name: copy.forecast.requestOne("6 Shampoo sachets") }).click();
  await expect(days.getByRole("status")).toHaveText(/^Requested \d{1,2}(:\d{2})? [ap]m · ops will add it/);
  expect(writesTo(fake, "kit/requests")).toHaveLength(1);
  await expect(days.getByRole("button", { name: copy.forecast.requestOne("6 Shampoo sachets") })).toHaveCount(0);
});
