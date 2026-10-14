// References a client or a supplier reads, which tell them nothing of how many came before: a payment's is random
// letters and digits, and an order's or a claim's number is drawn at random from those no row has yet.

/** Letters and digits no one misreads for another: no 0 or O, no 1 or I. */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** "MM-7KQ3-9F2D": a payment's reference, as the client reads it on the link and the receipt. */
export function paymentReference(): string {
  const code = Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => ALPHABET[byte % ALPHABET.length]);
  return `MM-${code.slice(0, 4).join("")}-${code.slice(4).join("")}`;
}

/** Five six-digit numbers drawn at random, as JSON, for `freshNumber` to take the first free one of. */
export function drawnNumbers(): string {
  return JSON.stringify(Array.from(crypto.getRandomValues(new Uint32Array(5)), (n) => 100_000 + (n % 900_000)));
}

/** Inside a statement writing a row of `table`: the first of the numbers drawn, bound at `placeholder`, no row has. */
export const freshNumber = (table: "purchase_orders" | "custom_orders" | "supplier_claims", placeholder: string) =>
  `(SELECT value FROM json_each(${placeholder}) WHERE value NOT IN (SELECT number FROM ${table}) ORDER BY key LIMIT 1)`;
