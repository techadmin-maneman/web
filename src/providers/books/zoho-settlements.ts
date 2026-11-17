// Razorpay's settlements in Zoho Books (docs/decisions/0261-razorpay-money-in-books.md), behind BooksProvider
// (./index.ts): the payout to the bank as a transfer between two of our accounts, and Razorpay's fee as an expense paid
// out of Razorpay's account. Each is looked for by its reference before it is recorded, so an answer that never came
// records nothing twice. Amounts are rupees here, as everywhere in Books.
//   GET  /books/v3/banktransactions&account_id=&reference_number=   { banktransactions }
//   POST /books/v3/banktransactions               { banktransaction }, its transaction_type transfer_fund
//   GET  /books/v3/expenses&reference_number=     { expenses }
//   POST /books/v3/expenses                       { expense }, paid through Razorpay's account

import { z } from "zod";
import type { BooksProvider } from "./index.ts";
import type { BooksApi } from "./zoho.ts";

type Settlements = Pick<BooksProvider, "findTransfer" | "recordTransfer" | "findExpense" | "recordExpense">;

/** Paise as Books takes an amount: rupees. */
const rupees = (paise: number) => paise / 100;

const TransfersFound = z.object({
  banktransactions: z
    .array(z.object({ transaction_id: z.string(), reference_number: z.string().nullish() }))
    .default([]),
});

const ExpensesFound = z.object({
  expenses: z.array(z.object({ expense_id: z.string(), reference_number: z.string().nullish() })).default([]),
});

export function settlementCalls({ at, read }: BooksApi): Settlements {
  return {
    async findTransfer(fromAccountId, reference) {
      const query = `&account_id=${encodeURIComponent(fromAccountId)}&reference_number=${encodeURIComponent(reference)}`;
      const found = await read({
        step: "find_transfer",
        path: at("/banktransactions", query),
        schema: TransfersFound,
        under: [],
      });
      return found.banktransactions.find((each) => each.reference_number === reference)?.transaction_id ?? null;
    },

    recordTransfer: (transfer) =>
      read({
        step: "record_transfer",
        path: at("/banktransactions"),
        schema: z.string(),
        under: ["banktransaction", "transaction_id"],
        write: {
          method: "POST",
          body: {
            transaction_type: "transfer_fund",
            from_account_id: transfer.fromAccountId,
            to_account_id: transfer.toAccountId,
            amount: rupees(transfer.amount),
            date: transfer.date,
            reference_number: transfer.reference,
            description: transfer.description,
          },
        },
      }),

    async findExpense(reference) {
      const query = `&reference_number=${encodeURIComponent(reference)}`;
      const found = await read({
        step: "find_expense",
        path: at("/expenses", query),
        schema: ExpensesFound,
        under: [],
      });
      return found.expenses.find((each) => each.reference_number === reference)?.expense_id ?? null;
    },

    recordExpense: (expense) =>
      read({
        step: "record_expense",
        path: at("/expenses"),
        schema: z.string(),
        under: ["expense", "expense_id"],
        write: {
          method: "POST",
          body: {
            account_id: expense.accountId,
            paid_through_account_id: expense.paidThroughAccountId,
            amount: rupees(expense.amount),
            date: expense.date,
            reference_number: expense.reference,
            description: expense.description,
            // The GST in the fee, claimed as input credit once GST is on in Books; the amount includes it.
            ...(expense.taxId === null ? {} : { tax_id: expense.taxId, is_inclusive_tax: true }),
          },
        },
      }),
  };
}
