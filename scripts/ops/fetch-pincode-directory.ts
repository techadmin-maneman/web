// Every pincode India Post lists, from the Department of Posts' directory on data.gov.in, written to
// data/pincodes/india-pincodes.csv with the directory's date (data/pincodes/README.md). It reads a page of offices a
// call with a key of our own, then folds them into one row a pincode (scripts/lib/pincode-directory.ts). Read-only on
// data.gov.in; nothing reaches a database until load-pincode-directory.ts runs.
//
//   node --env-file=.env.data-gov scripts/ops/fetch-pincode-directory.ts
//   node --env-file=.env.data-gov scripts/ops/fetch-pincode-directory.ts --state MAHARASHTRA   (one state, to try it)

import { writeFileSync } from "node:fs";
import { directoryCsv, pincodesOf, type Office } from "../lib/pincode-directory.ts";

const RESOURCE = "https://api.data.gov.in/resource/5c2f62fe-5afa-4119-a499-fec9d604d5bd";
/** As many offices as one call may return for a key of our own. */
const PAGE = 10_000;
const FILE = "data/pincodes/india-pincodes.csv";
const DATED = "data/pincodes/india-pincodes.date";

const key = process.env.DATA_GOV_IN_API_KEY ?? "";
const [flag, state] = process.argv.slice(2);
if (key === "" || (flag !== undefined && (flag !== "--state" || state === undefined))) {
  console.error("usage: node --env-file=.env.data-gov scripts/ops/fetch-pincode-directory.ts [--state NAME]");
  process.exit(2);
}

interface Answer {
  readonly total: number;
  readonly updated_date?: string;
  readonly records: readonly Office[];
}

async function page(offset: number): Promise<Answer> {
  const url = new URL(RESOURCE);
  url.searchParams.set("api-key", key);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", String(PAGE));
  url.searchParams.set("offset", String(offset));
  if (state !== undefined) url.searchParams.set("filters[statename]", state.toUpperCase());
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) }).catch(() => null);
    if (response?.ok === true) return await response.json<Answer>();
    if (attempt === 3)
      throw new Error(`data.gov.in did not answer offset ${String(offset)} (${String(response?.status)})`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
  }
}

const first = await page(0);
const offices: Office[] = [...first.records];
if (first.records.length < Math.min(first.total, PAGE)) {
  console.error(`data.gov.in answered ${String(first.records.length)} offices a call: the key is not one of ours`);
  process.exit(1);
}
for (let offset = offices.length; offset < first.total; offset += PAGE) {
  offices.push(...(await page(offset)).records);
  console.log(`${String(offices.length)} of ${String(first.total)} offices`);
}
const pincodes = pincodesOf(offices);
writeFileSync(FILE, directoryCsv(pincodes));
const dated = (first.updated_date ?? new Date().toISOString()).slice(0, 10);
writeFileSync(DATED, `${dated}\n`);
console.log(`${String(pincodes.length)} pincodes from ${String(offices.length)} offices, dated ${dated}, in ${FILE}`);
