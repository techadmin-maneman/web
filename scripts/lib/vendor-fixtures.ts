// A vendor's real answer as a test fixture, under test/fixtures/vendors/<vendor>/<name>.json: every key as the vendor
// sent it, with any text that could be a person's replaced. IDs, amounts, dates, statuses and our own references,
// which is what a test reads, stay as sent.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { format, resolveConfig } from "prettier";

export const FIXTURES_DIR = join(import.meta.dirname, "..", "..", "test", "fixtures", "vendors");

/** What replaces a text that could be a person's. */
export const PLACEHOLDER = "Staging test";

/** Text kept as sent, besides IDs, dates and times: codes, statuses, kinds, and the numbers and references we gave. */
const KEPT_TEXT: ReadonlySet<string> = new Set([
  "code",
  "message",
  "status",
  "reference_number",
  "invoice_number",
  "payment_number",
  "currency_code",
  "payment_mode",
  "product_type",
  "item_type",
  "api_name",
  "column_name",
  "comparator",
]);

const MOBILE = /^\+?(91)?[6-9]\d{9}$/;

function keepsText(key: string, text: string): boolean {
  if (text.includes("@") || MOBILE.test(text.replace(/[\s-]/g, ""))) return false;
  const name = key.toLowerCase();
  if (name === "id" || name.endsWith("_id")) return true;
  if (/(^|_)(date|time)$/.test(name)) return true;
  return KEPT_TEXT.has(name);
}

/** The answer with every text that could be a person's replaced. Empty text, numbers, true, false and null stay. */
export function scrubbed(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((each) => scrubbed(each, key));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([name, inner]) => [name, scrubbed(inner, name)]));
  }
  if (typeof value !== "string" || value === "" || keepsText(key, value)) return value;
  return PLACEHOLDER;
}

/** Writes the answer, scrubbed and formatted as the repo formats JSON; returns the file's path. */
export async function writeFixture(vendor: string, name: string, answer: unknown): Promise<string> {
  const path = join(FIXTURES_DIR, vendor, `${name}.json`);
  const options = (await resolveConfig(path)) ?? {};
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, await format(JSON.stringify(scrubbed(answer), null, 2), { ...options, parser: "json" }));
  return path;
}
