// What scripts/release/check-books-setup.ts makes of the Books org's answers: the settings no runtime check reads, which an
// invoice depends on. The items each service is invoiced on are the Worker's own hourly check (src/domain/books-items.ts).
// This decides, and reaches nothing.

import { z } from "zod";
import { GSTIN_FORMAT } from "../../src/config/gst.ts";

export type Outcome = "pass" | "fail" | "skip";

export interface CheckLine {
  readonly outcome: Outcome;
  readonly check: string;
  readonly detail: string;
}

/** An answer from Books: its HTTP status and its JSON. */
export interface BooksAnswer {
  readonly status: number;
  readonly json: unknown;
}

const InvoiceSettings = z.object({
  invoice_settings: z.object({
    discount_type: z.string(),
    is_discount_before_tax: z.boolean().optional(),
  }),
});

/**
 * A discount code is taken off the invoice's line before tax, so Books must discount at line item level, before tax;
 * at transaction level it refuses such an invoice, or discounts it wrong.
 */
export function discountPreference(answer: unknown): CheckLine {
  const check = "invoice discounts";
  const read = InvoiceSettings.safeParse(answer);
  if (!read.success) return { outcome: "fail", check, detail: "Books' invoice settings could not be read" };
  const { discount_type: level, is_discount_before_tax: beforeTax } = read.data.invoice_settings;
  if (level === "item_level" && beforeTax === true) {
    return { outcome: "pass", check, detail: "at line item level, before tax" };
  }
  return {
    outcome: "fail",
    check,
    detail:
      `Books discounts ${level === "item_level" ? "after tax" : `as "${level}"`}. In Books, Settings → ` +
      "Preferences → Invoices, choose discounts at line item level, before tax.",
  };
}

const Organisation = z.object({
  organization: z.object({
    name: z.string(),
    currency_code: z.string(),
    state_code: z.string().optional(),
  }),
});

/** The organisation invoices are raised in, which keeps its accounts in rupees. */
export function organisation(answer: unknown): CheckLine {
  const check = "Books organisation";
  const read = Organisation.safeParse(answer);
  if (!read.success) return { outcome: "fail", check, detail: "not found: check ZOHO_BOOKS_ORG_ID" };
  const { name, currency_code: currency } = read.data.organization;
  return { outcome: currency === "INR" ? "pass" : "fail", check, detail: `${name}, ${currency}` };
}

/** The GST state codes of the states we serve, by the two letters Books names a place of supply with. */
const GST_STATE_DIGITS: Readonly<Record<string, { readonly digits: string; readonly name: string }>> = {
  HR: { digits: "06", name: "Haryana" },
  DL: { digits: "07", name: "Delhi" },
  UP: { digits: "09", name: "Uttar Pradesh" },
};

const stateOfDigits = (digits: string): string | null =>
  Object.entries(GST_STATE_DIGITS).find(([, state]) => state.digits === digits)?.[0] ?? null;

/** BOOKS_GSTIN and BOOKS_GST_STATE, as the Worker reads them. */
export interface GstSettings {
  readonly gstin: string | null;
  readonly stateCode: string | null;
}

/**
 * Mane Man's GST identity agrees with itself: the GSTIN's first two digits are the state set beside it, which is one
 * we serve, and where Books says which state the organisation is in, it is that one.
 */
export function gstIdentity(gst: GstSettings, organisationAnswer: unknown): CheckLine[] {
  const check = "GST";
  if (gst.gstin === null)
    return [{ outcome: "skip", check, detail: "off: BOOKS_GSTIN is empty, so no invoice carries GST" }];
  const registered = registrationLine(gst.gstin, gst.stateCode);
  const kept = Organisation.safeParse(organisationAnswer);
  const keptIn = kept.success ? kept.data.organization.state_code : undefined;
  if (keptIn === undefined || keptIn === gst.stateCode) return [registered];
  return [
    registered,
    {
      outcome: "fail",
      check: "Books organisation's state",
      detail: `Books keeps the organisation in ${keptIn}, and its GSTIN is of ${gst.stateCode ?? "no state"}`,
    },
  ];
}

function registrationLine(gstin: string, stateCode: string | null): CheckLine {
  const check = "GST";
  if (!GSTIN_FORMAT.test(gstin)) return { outcome: "fail", check, detail: "BOOKS_GSTIN is not written as a GSTIN" };
  const digits = gstin.slice(0, 2);
  const registeredIn = stateOfDigits(digits);
  if (registeredIn === null) {
    return { outcome: "fail", check, detail: `the GSTIN is of state ${digits}, which is none we serve` };
  }
  if (registeredIn !== stateCode) {
    const name = GST_STATE_DIGITS[registeredIn]?.name ?? registeredIn;
    return {
      outcome: "fail",
      check,
      detail: `the GSTIN is of ${name} (${registeredIn}), and BOOKS_GST_STATE is ${stateCode ?? "empty"}`,
    };
  }
  return { outcome: "pass", check, detail: `registered in ${registeredIn}` };
}

const BankAccount = z.object({ bankaccount: z.object({ account_name: z.string(), is_active: z.boolean() }) });

/** Books' "not authorised" code: the token lacks the scope the call needs. */
const NOT_AUTHORISED = 57;

const isNotAuthorised = (answer: BooksAnswer): boolean =>
  answer.status === 401 ||
  (typeof answer.json === "object" &&
    answer.json !== null &&
    "code" in answer.json &&
    answer.json.code === NOT_AUTHORISED);

/** The account refunds are paid from, which Razorpay settles into: without it, no refund is recorded in Books. */
export function refundAccount(accountId: string | null, answer: BooksAnswer | null): CheckLine {
  const check = "refund account";
  if (accountId === null || answer === null) {
    return { outcome: "fail", check, detail: "BOOKS_REFUND_ACCOUNT_ID is empty, so no refund is recorded in Books" };
  }
  if (isNotAuthorised(answer)) {
    return {
      outcome: "skip",
      check,
      detail: `${accountId} could not be read: the scripts' token reads accounts with ZohoBooks.banking.READ`,
    };
  }
  const read = BankAccount.safeParse(answer.json);
  if (!read.success) return { outcome: "fail", check, detail: `Books holds no account ${accountId}` };
  const { account_name: name, is_active: active } = read.data.bankaccount;
  return { outcome: active ? "pass" : "fail", check, detail: `${accountId}, ${name}${active ? "" : ", inactive"}` };
}
