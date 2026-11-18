// Zoho Books' adapter for Razorpay's settlements (src/providers/books/zoho-settlements.ts): the transfer to the bank and
// the fee's expense, each in rupees, and each found again by its reference. The answers' shapes are Books' documented
// ones; every ID here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { json } from "../helpers.ts";
import {
  BOOKS_API,
  booksCalls,
  sent,
  taxesListed,
  tokenIssued,
  ZOHO_TOKEN_URL,
  zohoBooks,
} from "./books-provider-fixtures.ts";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM zoho_access_tokens").run();
});

const EXPENSE = {
  accountId: "acct-fees",
  paidThroughAccountId: "acct-razorpay",
  amount: 47_200,
  date: "2026-09-20",
  reference: "setl_1",
  description: "Razorpay's fee on settlement setl_1",
};

describe("Books: Razorpay's settlements", () => {
  it("records the payout as a transfer from Razorpay's account to the bank, in rupees, and answers its ID", async () => {
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/banktransactions`]: () => json({ code: 0, banktransaction: { transaction_id: "bt-1" } }, 201),
    });
    const id = await books.recordTransfer({
      fromAccountId: "acct-razorpay",
      toAccountId: "acct-kotak",
      amount: 1_900_000,
      date: "2026-09-20",
      reference: "UTR123",
      description: "Razorpay settlement setl_1",
    });
    expect(id).toBe("bt-1");
    expect(calls[1]?.method).toBe("POST");
    expect(sent(calls[1])).toEqual({
      transaction_type: "transfer_fund",
      from_account_id: "acct-razorpay",
      to_account_id: "acct-kotak",
      amount: 19000,
      date: "2026-09-20",
      reference_number: "UTR123",
      description: "Razorpay settlement setl_1",
    });
  });

  it("finds a transfer out of Razorpay's account by its reference exactly, and answers null for none", async () => {
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/banktransactions`]: () =>
        json({
          code: 0,
          banktransactions: [
            { transaction_id: "near-miss", reference_number: "UTR1230" },
            { transaction_id: "bt-1", reference_number: "UTR123" },
          ],
        }),
    });
    expect(await books.findTransfer("acct-razorpay", "UTR123")).toBe("bt-1");
    const searched = new URL(calls[1]?.url ?? "");
    expect(searched.searchParams.get("account_id")).toBe("acct-razorpay");
    expect(searched.searchParams.get("reference_number")).toBe("UTR123");
    expect(await books.findTransfer("acct-razorpay", "UTR999")).toBeNull();
  });

  it("records the fee as an expense paid out of Razorpay's account, its GST and whose it is only with GST", async () => {
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/settings/taxes`]: () => taxesListed(),
      [`${BOOKS_API}/expenses`]: () => json({ code: 0, expense: { expense_id: "be-1" } }, 201),
    });
    expect(await books.recordExpense({ ...EXPENSE, gst: null })).toBe("be-1");
    const gst = { percent: 18, intraState: false, supplierGstin: "29AAGCR4375J1ZU", sourceState: "KA" };
    await books.recordExpense({ ...EXPENSE, gst: { ...gst, destinationState: "DL" } });
    const untaxed = {
      account_id: "acct-fees",
      paid_through_account_id: "acct-razorpay",
      amount: 472,
      date: "2026-09-20",
      reference_number: "setl_1",
      description: "Razorpay's fee on settlement setl_1",
    };
    const written = booksCalls(calls).filter((call) => call.url.includes("/expenses"));
    expect(sent(written[0])).toEqual(untaxed);
    expect(sent(written[1])).toEqual({
      ...untaxed,
      tax_id: "tax-igst18",
      is_inclusive_tax: true,
      gst_treatment: "business_gst",
      gst_no: "29AAGCR4375J1ZU",
      source_of_supply: "KA",
      destination_of_supply: "DL",
    });
  });

  it("finds an expense by its reference exactly, and answers null for none", async () => {
    const { books } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/expenses`]: () =>
        json({ code: 0, expenses: [{ expense_id: "near-miss", reference_number: "setl_10" }] }),
    });
    expect(await books.findExpense("setl_1")).toBeNull();
    expect(await books.findExpense("setl_10")).toBe("near-miss");
  });
});
