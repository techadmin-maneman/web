// Operations · Purchasing, its claims (docs/decisions/0169-supplier-claims.md): claims on suppliers listed with their
// reason and value, a drafted one marked sent and a sent one settled as a credit; and returned pieces claimed while in
// warranty, or written off with why.

import type { Page } from "@playwright/test";
import { expect, test, TINY_JPEG } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, jpeg, json, type Answers, type OpsReply } from "./fixtures.ts";
import { purchasing as copy } from "../../apps/ops/src/content/purchasing.ts";

const ORDERS = {
  orders: [],
  suppliers: [{ id: "sup-1", name: "Lumina Hair Co", currency: "USD", payment_terms_days: 0, items: [] }],
  consumables: [],
  second_approval_above_rupees: 0,
  letterhead: null,
} satisfies OpsReply<"/api/purchase-orders">;

const CLAIM = {
  id: "cl-1",
  number: 1,
  supplier_id: "sup-1",
  consumable_code: "solvent",
  name: "Solvent",
  quantity: 2,
  reason: "damaged" as const,
  order_number: 3,
  piece_code: null,
  unit_price: 250,
  currency: "USD",
  state: "drafted" as const,
  outcome: null,
  credit_amount: null,
  note: null,
  drafted_at: "2026-09-21T06:30:00.000Z",
  sent_at: null,
  decided_at: null,
  photo_id: null,
};

const PHOTO_ID = "5b0c7a8e-3f1d-4c2b-9a6e-1d2f3a4b5c6d";

const PIECE = {
  id: "ret-1",
  piece_code: "MM-ESS-0000001-B",
  name: "Mane Man Essential 8x10 1B",
  reason: "Lifting at the front",
  returned_at: "2026-10-01T06:30:00.000Z",
  handed_in_at: "2026-10-02T06:30:00.000Z",
  handed_in_to: "Gurgaon stockroom",
  supplier_id: "sup-1",
  warranty_ends_on: "2026-12-20",
  in_warranty: true,
};

const CLAIMS = { claims: [CLAIM], returns: [PIECE] } satisfies OpsReply<"/api/supplier-claims">;

const SCORES = {
  suppliers: [
    {
      supplier_id: "sup-1",
      name: "Lumina Hair Co",
      currency: "USD",
      orders: 4,
      on_time_in_full_percent: 75,
      lead_days: 13.5,
      promised_days: 14,
      failed_check_percent: 6,
      damaged_percent: 2,
      claims_settled: 3,
      claims_accepted: 2,
      credited: 1250,
    },
  ],
} satisfies OpsReply<"/api/supplier-scorecard">;

async function open(page: Page, extra: Answers = {}): Promise<void> {
  await answer(page, {
    "GET /api/purchase-orders": json(ORDERS),
    "GET /api/supplier-claims": json(CLAIMS),
    "GET /api/supplier-scorecard": json(SCORES),
    ...extra,
  });
  await page.goto("/purchasing");
  await expect(page.getByRole("heading", { name: copy.claims.title })).toBeVisible();
}

const posted = (page: Page, path: string) =>
  page.waitForRequest((request) => request.url().endsWith(path) && request.method() === "POST");

test("lists each claim with its reason and value, and marks a drafted one sent", async ({ page }) => {
  const sent = { ...CLAIMS, claims: [{ ...CLAIM, state: "sent" as const, note: "Photos emailed." }] };
  await open(page, { "POST /api/supplier-claims/{id}/send": json(sent) });
  const claims = page.getByRole("region", { name: copy.claims.title });
  const row = claims.getByRole("row").filter({ hasText: "CL-0001" });
  await expect(row).toContainText("Lumina Hair Co");
  await expect(row).toContainText(copy.claims.reasons.damaged);
  await expect(row).toContainText("USD 5.00");

  await claims.getByRole("button", { name: copy.claims.open("CL-0001") }).click();
  await expect(claims).toContainText(copy.claims.from("PO-0003"));
  await claims.getByLabel(copy.claims.note).fill("Photos emailed.");
  const request = posted(page, "/api/supplier-claims/cl-1/send");
  await claims.getByRole("button", { name: copy.claims.send }).click();
  expect((await request).postDataJSON()).toEqual({ note: "Photos emailed.", photo_id: null });
  await expect(row).toContainText(copy.claims.states.sent);
  expect(await axeViolations(page)).toEqual([]);
});

test("settles a sent claim as the credit the supplier gave", async ({ page }) => {
  const sentClaim = { ...CLAIM, state: "sent" as const };
  const credited = {
    ...CLAIMS,
    claims: [{ ...sentClaim, state: "accepted" as const, outcome: "credit" as const, credit_amount: 400 }],
  };
  await open(page, {
    "GET /api/supplier-claims": json({ ...CLAIMS, claims: [sentClaim] }),
    "POST /api/supplier-claims/{id}/decide": json(credited),
  });
  const claims = page.getByRole("region", { name: copy.claims.title });
  await claims.getByRole("button", { name: copy.claims.open("CL-0001") }).click();
  const credit = claims.getByLabel(copy.claims.credit("USD"));
  await expect(credit).toHaveValue("5.00");
  await credit.fill("4");
  const request = posted(page, "/api/supplier-claims/cl-1/decide");
  await claims.getByRole("button", { name: copy.claims.credited }).click();
  expect((await request).postDataJSON()).toEqual({ outcome: "credit", credit_amount: 400, note: null });
  await expect(claims.getByRole("row").filter({ hasText: "CL-0001" })).toContainText(copy.claims.outcomes.credit);
});

test("claims a returned piece inside its warranty, and writes off another with why", async ({ page }) => {
  const late = { ...PIECE, id: "ret-2", piece_code: "MM-ESS-0000002-C", in_warranty: false };
  const claimed = {
    claims: [{ ...CLAIM, id: "cl-2", number: 2, reason: "warranty" as const, piece_code: PIECE.piece_code }, CLAIM],
    returns: [late],
  };
  await open(page, {
    "GET /api/supplier-claims": json({ ...CLAIMS, returns: [PIECE, late] }),
    "POST /api/returned-pieces/{id}/claim": json(claimed),
    "POST /api/returned-pieces/{id}/write-off": json({ ...claimed, returns: [] }),
    "POST /api/stock-photos": json({ photo_id: PHOTO_ID }, 201),
    "GET /api/stock-photos/{id}": jpeg(TINY_JPEG.buffer),
  });
  const pieces = page.getByRole("region", { name: copy.returns.title });
  await expect(pieces.getByRole("row").filter({ hasText: PIECE.piece_code })).toContainText(
    copy.returns.until("Sun 20 Dec"),
  );
  const lateRow = pieces.getByRole("row").filter({ hasText: late.piece_code });
  await expect(lateRow.getByRole("button", { name: copy.returns.claim })).toHaveCount(0);

  const claim = posted(page, "/api/returned-pieces/ret-1/claim");
  await pieces
    .getByRole("row")
    .filter({ hasText: PIECE.piece_code })
    .getByRole("button", { name: copy.returns.claim })
    .click();
  await claim;
  await expect(page.getByRole("region", { name: copy.claims.title })).toContainText("CL-0002");

  await lateRow.getByRole("button", { name: copy.returns.writeOff }).click();
  await lateRow.getByLabel(copy.returns.why).fill("Torn base");
  await expect(lateRow.getByRole("button", { name: copy.returns.confirmWriteOff })).toBeDisabled();
  await lateRow.getByLabel(copy.photo.writeOff).setInputFiles(TINY_JPEG);
  await expect(lateRow.getByRole("img", { name: copy.photo.alt })).toBeVisible();
  const writeOff = posted(page, "/api/returned-pieces/ret-2/write-off");
  await lateRow.getByRole("button", { name: copy.returns.confirmWriteOff }).click();
  expect((await writeOff).postDataJSON()).toEqual({ reason: "Torn base", photo_id: PHOTO_ID });
  await expect(pieces).toContainText(copy.returns.none);
});

test("scores each supplier’s year: on time in full, lead time against promised, quality and claims", async ({
  page,
}) => {
  await open(page);
  const scores = page.getByRole("region", { name: copy.scorecard.title });
  const row = scores.getByRole("row").filter({ hasText: "Lumina Hair Co" });
  for (const figure of ["75%", "13.5 of 14 days", "6%", "2%", "2 of 3", "USD 12.50"]) {
    await expect(row).toContainText(figure);
  }
  expect(await axeViolations(page)).toEqual([]);
});
