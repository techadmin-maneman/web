// Money · Payments: Finance had no list of the money at all, only a day's charges, and no way to find a client's
// payment without Customer Care's access. The ledger lists every payment over the days chosen, finds one by client or
// reference, says where Books stands, exports the list, and shows the links still unpaid.

import { readFile } from "node:fs/promises";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, json, type OpsReply } from "./answer.ts";
import { ledger as copy } from "../../apps/ops/src/content/ledger.ts";
import { tables } from "../../apps/ops/src/content.ts";

const LEDGER = {
  from: "2026-08-23",
  to: "2026-09-21",
  payments: [
    {
      id: "6a000000-0000-4000-8000-000000000002",
      reference: "MM-R-2",
      person: { id: "22000000-0000-4000-8000-000000000002", name: "Meera Iyer" },
      kind: "visit",
      method: "card",
      status: "captured",
      amount: 3_200_000,
      refunded_amount: 0,
      created_at: "2026-09-20T05:00:00.000Z",
      captured_at: "2026-09-20T05:00:00.000Z",
      books: "waiting" as const,
    },
    {
      id: "6a000000-0000-4000-8000-000000000001",
      reference: "MM-R-1",
      person: { id: "22000000-0000-4000-8000-000000000001", name: "Rohit Malhotra" },
      kind: "visit",
      method: "upi",
      status: "partially_refunded",
      amount: 220_000,
      refunded_amount: 20_000,
      created_at: "2026-09-18T05:00:00.000Z",
      captured_at: "2026-09-18T05:00:00.000Z",
      books: "applied" as const,
    },
  ],
  more: false,
  unpaid_links: [
    {
      id: "6b000000-0000-4000-8000-000000000001",
      reference: "MM-L-7",
      person: { id: "22000000-0000-4000-8000-000000000003", name: "Kabir Sethi" },
      amount: 2_500_000,
      created_at: "2026-09-19T05:00:00.000Z",
      sent_at: "2026-09-19T05:00:00.000Z",
      refused_at: null,
      closes_at: null,
    },
  ],
  more_links: false,
} satisfies OpsReply<"/api/payments/ledger">;

test("lists the days' payments, finds one by client, exports them, and shows the links unpaid", async ({ page }) => {
  await answer(page, { "GET /api/payments/ledger": json(LEDGER) });
  await page.goto("/ledger");
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();

  const payments = page.getByRole("region", { name: copy.payments.title, exact: true });
  await expect(payments.getByRole("rowheader")).toHaveCount(2);
  await expect(payments.getByRole("row").nth(1)).toContainText(copy.books.waiting);
  await expect(payments.getByRole("row").nth(2)).toContainText(copy.statuses.partially_refunded ?? "");
  await expect(payments.getByRole("row").nth(2)).toContainText(copy.books.applied);

  await payments.getByRole("searchbox", { name: tables.search }).fill("rohit");
  await expect(payments.getByRole("row")).toHaveCount(2);
  await expect(payments.getByRole("row").nth(1)).toContainText("Rohit Malhotra");

  const links = page.getByRole("region", { name: copy.links.title });
  await expect(links).toContainText("Kabir Sethi");
  await expect(links).toContainText(copy.links.states.sent);
  expect(await axeViolations(page)).toEqual([]);

  const saving = page.waitForEvent("download");
  await page.getByRole("button", { name: copy.export }).click();
  const file = await saving;
  expect(file.suggestedFilename()).toBe(copy.fileName(LEDGER.from, LEDGER.to));
  const text = await readFile(await file.path(), "utf8");
  expect(text.split("\n")).toHaveLength(3);
});
