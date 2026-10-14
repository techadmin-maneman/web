// The technician's kit (docs/decisions/0164-the-kit-screen.md): opened from today, it shows what the kit holds with
// each lot's expiry, receives a top-up by the pieces scanned, and hands back returned pieces and expired stock; its
// writes need signal and say so without it.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fakeTech, type Fake } from "./fake-tech.ts";
import { writesTo } from "./steps-fixtures.ts";
import * as techCopy from "../../apps/tech/src/content.ts";

const copy = techCopy.kit;
const HAIR = "Mane Man Essential 8x10 1B, 20% grey, 120%";

function withAKit(fake: Fake): void {
  fake.kit = {
    held: [
      {
        code: "solvent",
        name: "Solvent",
        unit: "ml",
        quantity: 120,
        hair_system: false,
        lots: [
          { lot_code: "SV-1", expires_on: "2020-01-31", quantity: 20 },
          { lot_code: "SV-2", expires_on: "2031-01-31", quantity: 100 },
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
  };
}

test("opens from today, shows each lot's expiry, and receives a top-up by the pieces scanned", async ({ page }) => {
  const fake = await fakeTech(page);
  withAKit(fake);
  await page.goto("/");
  await page.getByRole("link", { name: copy.link }).click();
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();

  const held = page.getByRole("region", { name: copy.held.title });
  await expect(held).toContainText("SV-1 · 20 · Expired 31 Jan");
  await expect(held).toContainText("SV-2 · 100 · Expires 31 Jan");

  const coming = page.getByRole("region", { name: copy.coming.title });
  const scan = coming.getByLabel(copy.scan.label);
  await scan.fill("mm-ess-0000007-h");
  await scan.press("Enter");
  await expect(coming).toContainText(copy.coming.scanned(1, 2));
  await scan.fill("MM-ESS-0000099-A");
  await scan.press("Enter");
  await expect(coming.getByRole("alert")).toHaveText(copy.coming.notOnIt);
  expect(await axeViolations(page)).toEqual([]);

  await coming.getByRole("button", { name: copy.coming.receiveScanned(1) }).click();
  await expect.poll(() => writesTo(fake, "transfers/tr-1/receive").length).toBe(1);
  expect(writesTo(fake, "transfers/tr-1/receive")[0]?.body).toEqual({
    units: ["MM-ESS-0000007-H"],
    rest: "on_its_way",
  });
});

test("hands back the pieces that came off, and the expired stock", async ({ page }) => {
  const fake = await fakeTech(page);
  withAKit(fake);
  await page.goto("/kit");
  const back = page.getByRole("region", { name: copy.returned.title });
  await expect(back).toContainText(copy.returned.line("MM-STD-4417-B", "1 Jul"));
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
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "internal", request_id: "kit-ref-1", fields: [] } }),
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
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByRole("button", { name: copy.needsSignal }).first()).toBeDisabled();
});
