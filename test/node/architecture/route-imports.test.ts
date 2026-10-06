// What a route module may import of the other routes (docs/architecture.md): shared schemas from src/routes/schemas/,
// and the parts of its own module (tech/jobs.ts and its jobs.*.ts, the public forms and public/forms.ts). One route
// reaching into another's file for a schema or a helper ties the two surfaces together. The baseline is today's, and
// it only shrinks: a schema moves to schemas/, a helper to the domain or http/.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path/posix";
import { describe, expect, it } from "vitest";

const BASELINE = [
  "src/routes/client/changes.ts -> src/routes/client/booking.ts",
  "src/routes/client/discount-codes.ts -> src/routes/client/booking.ts",
  "src/routes/client/me.ts -> src/routes/client/booking.ts",
  "src/routes/client/me.ts -> src/routes/client/payments.ts",
  "src/routes/client/me.ts -> src/routes/client/refer.ts",
  "src/routes/client/me.ts -> src/routes/client/visits.ts",
  "src/routes/client/me.ts -> src/routes/public/referral-reward.ts",
  "src/routes/client/payments.ts -> src/routes/client/visits.ts",
  "src/routes/ops/client-record.ts -> src/routes/client/payments.ts",
  "src/routes/ops/client-record.ts -> src/routes/client/visits.ts",
  "src/routes/ops/client-record.ts -> src/routes/ops/client-referral.ts",
  "src/routes/ops/field.ts -> src/routes/tech/pieces.ts",
  "src/routes/ops/profile.ts -> src/routes/ops/erasure.ts",
  "src/routes/ops/services.ts -> src/routes/ops/settings.ts",
  "src/routes/ops/visits.ts -> src/routes/client/booking.ts",
  "src/routes/ops/whoami.ts -> src/routes/ops/staff.ts",
  "src/routes/public/published-prices.ts -> src/routes/client/booking.ts",
  "src/routes/public/referral-landing.ts -> src/routes/public/consultations.ts",
  "src/routes/public/tryon-claim.ts -> src/routes/public/number-codes.ts",
  "src/routes/public/tryon-result.ts -> src/routes/public/tryon-generate.ts",
  "src/routes/tech/jobs.schemas.ts -> src/routes/tech/pieces.ts",
];

/** The module a file belongs to: tech/jobs.steps.ts is part of tech/jobs.ts. */
const moduleOf = (file: string) => file.replace(/\.(piece|read|record|routes|schemas|steps)\.ts$/, ".ts");

/** The two public forms share public/forms.ts, which is theirs alone. */
const SHARED_WITHIN = new Map([
  ["src/routes/public/forms.ts", ["src/routes/public/consultations.ts", "src/routes/public/referral-landing.ts"]],
]);

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return filesUnder(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

const IMPORT = /^(?:import|export)\s+(?:type\s+)?[^;]*?from\s+"(\.[^"]+)";/gms;

const reaching = filesUnder("src/routes").flatMap((from) =>
  [...readFileSync(from, "utf8").matchAll(IMPORT)]
    .map((match) => normalize(join(dirname(from), match[1] ?? "")))
    .filter((to) => to.startsWith("src/routes/") && !to.startsWith("src/routes/schemas/"))
    .filter((to) => moduleOf(to) !== moduleOf(from) && !(SHARED_WITHIN.get(to) ?? []).includes(from))
    .map((to) => `${from} -> ${to}`),
);

describe("a route module", () => {
  it("imports of other routes only their shared schemas", () => {
    expect(reaching.filter((edge) => !BASELINE.includes(edge))).toEqual([]);
  });

  it("keeps no baseline entry that has since gone, so the baseline only shrinks", () => {
    expect(BASELINE.filter((edge) => !reaching.includes(edge))).toEqual([]);
  });
});
