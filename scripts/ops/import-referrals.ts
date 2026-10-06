// Back-fills the referrals ops logged before January into the ledger and attributions
// (docs/decisions/0048-referrals.md, docs/archive/phase2-inputs.md, section 9). Safe to run again: a person, a code and
// a grant are each written once.
//
//   node scripts/ops/import-referrals.ts local --file data/referrals/sample-referrals.csv
//   node scripts/ops/import-referrals.ts staging --file data/referrals/sample-referrals.csv
//   node scripts/ops/import-referrals.ts production --file private/referrals-before-january.csv
//
// The real file holds names and numbers: it lives in git-ignored private/, and nothing here prints them. Credits
// imported expire 365 days after the import (ADR 0025, item 24), so none arrives expired.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isEnvironmentName } from "../../src/config/environments.ts";
import { newReferralCode } from "../../src/domain/referrals/referrals.ts";
import { CREDIT_TTL_DAYS, CREDITS_PER_REFERRAL } from "../../src/policy/referral-reward.ts";
import { d1Execute } from "../lib/d1.ts";
import { sqlLiteral } from "../lib/sql-literal.ts";
import { fields } from "../lib/pincodes.ts";

const [environment, flag, file] = process.argv.slice(2);
if (!isEnvironmentName(environment) || flag !== "--file" || file === undefined) {
  console.error("usage: node scripts/ops/import-referrals.ts <local|staging|production> --file <path>");
  process.exit(2);
}

const now = new Date();
const at = now.toISOString();
const expiresAt = new Date(now.getTime() + CREDIT_TTL_DAYS * 86_400_000).toISOString();

/** Where the grant stands: given, waiting on the friend's first fit, or due once they are fitted. */
function grantState(granted: boolean, firstFitOn: string): string {
  if (granted) return "granted";
  return firstFitOn === "" ? "pending" : "approved";
}

/** The same pair always gets the same IDs, so running the import again writes nothing twice. */
function idFor(seed: string): string {
  const hash = createHash("sha256").update(seed).digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    ((Number.parseInt(hash.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join("-");
}

const e164 = (mobile: string) => {
  const digits = mobile.replace(/\D/g, "").slice(-10);
  if (!/^[6-9]\d{9}$/.test(digits)) throw new Error("a mobile number in the file is not an Indian mobile number");
  return `+91${digits}`;
};

const [header = "", ...lines] = readFileSync(file, "utf8").trim().split(/\r?\n/);
const columns = fields(header);
const at_ = (row: string[], name: string) => (row[columns.indexOf(name)] ?? "").trim();

const sql: string[] = [];
const person = (mobile: string, name: string) => {
  sql.push(
    `INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES (${sqlLiteral(idFor(`person:${mobile}`))}, ${sqlLiteral(at)}, ${sqlLiteral(mobile)}, ${sqlLiteral(name)}, 1)
     ON CONFLICT (mobile_e164) DO NOTHING;`,
  );
  return `(SELECT id FROM people WHERE mobile_e164 = ${sqlLiteral(mobile)})`;
};

let rows = 0;
for (const line of lines) {
  const row = fields(line);
  if (at_(row, "referrer_mobile") === "" || at_(row, "referred_mobile") === "") continue;
  rows += 1;
  const referrerMobile = e164(at_(row, "referrer_mobile"));
  const referredMobile = e164(at_(row, "referred_mobile"));
  const referrer = person(referrerMobile, at_(row, "referrer_name"));
  const referred = person(referredMobile, at_(row, "referred_name"));
  const code = newReferralCode(at_(row, "referrer_name"));
  sql.push(
    `INSERT INTO referral_codes (code, person_id, created_at, updated_at) VALUES (${sqlLiteral(code)}, ${referrer}, ${sqlLiteral(at)}, ${sqlLiteral(at)})
     ON CONFLICT (person_id) DO NOTHING;`,
  );
  const theirCode = `(SELECT code FROM referral_codes WHERE person_id = ${referrer})`;
  const attribution = idFor(`referral:${referrerMobile}:${referredMobile}`);
  const granted = at_(row, "credits_given").toLowerCase() === "yes";
  const firstFitOn = at_(row, "first_fit_on");
  sql.push(
    `INSERT INTO referral_attributions (id, code, referred_person_id, first_touch_at, via, grant_state, created_at,
       updated_at)
     VALUES (${sqlLiteral(attribution)}, ${theirCode}, ${referred}, ${sqlLiteral(at_(row, "referred_on") || at)}, 'consultation',
       ${sqlLiteral(grantState(granted, firstFitOn))}, ${sqlLiteral(at)}, ${sqlLiteral(at)})
     ON CONFLICT (referred_person_id) DO NOTHING;`,
  );
  // The credits the log says were given, less those already used, as one grant and one correction each.
  if (granted) {
    for (const [who, used] of [
      [referrer, Number(at_(row, "credits_used_referrer") || "0")],
      [referred, Number(at_(row, "credits_used_referred") || "0")],
    ] as const) {
      sql.push(
        `INSERT INTO credit_ledger (id, person_id, kind, visits, source_kind, source_id, expires_at, created_at)
         VALUES (${sqlLiteral(crypto.randomUUID())}, ${who}, 'grant', ${String(CREDITS_PER_REFERRAL)}, 'import', ${sqlLiteral(attribution)},
           ${sqlLiteral(expiresAt)}, ${sqlLiteral(at)})
         ON CONFLICT DO NOTHING;`,
      );
      if (used > 0) {
        const grant = `(SELECT id FROM credit_ledger WHERE kind = 'grant' AND source_kind = 'import' AND source_id = ${sqlLiteral(attribution)} AND person_id = ${who})`;
        sql.push(
          `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
           SELECT ${sqlLiteral(crypto.randomUUID())}, ${who}, 'adjust', ${String(-Math.min(used, CREDITS_PER_REFERRAL))}, ${grant},
             'import', ${sqlLiteral(`${attribution}:used`)}, ${sqlLiteral(at)}
           WHERE NOT EXISTS (SELECT 1 FROM credit_ledger WHERE kind = 'adjust' AND source_kind = 'import'
             AND source_id = ${sqlLiteral(`${attribution}:used`)} AND person_id = ${who});`,
        );
      }
    }
  }
}

d1Execute(environment, sql, true);
console.log(`import-referrals: ${String(rows)} referrals into ${environment}`);
