// The read-only check that every R2 bucket an environment binds exists and
// keeps its objects as long as it should (scripts/check-buckets.ts), against a
// fake account. The try-on buckets' 30-day rule is set by hand at provisioning
// (docs/runbook.md, step 1), so nothing else would notice it gone.

import { describe, expect, it } from "vitest";
import { boundBuckets, checkBuckets, RETENTION } from "../../scripts/lib/buckets.ts";
import { readJsonc } from "../../scripts/lib/jsonc.ts";
import { WORKERS } from "../../scripts/lib/workers.ts";

const API = readJsonc("wrangler.jsonc");
const DAY = 24 * 60 * 60;

describe("the buckets each environment binds", () => {
  it.each(["staging", "production"] as const)("in %s, each has a retention recorded", (environment) => {
    const bound = WORKERS.flatMap((worker) => boundBuckets(readJsonc(worker.config), environment));
    expect(bound.length).toBeGreaterThan(0);
    for (const { binding } of bound) expect(RETENTION[binding], binding).toBeDefined();
  });

  it("include production's referral cards, which no provisioning step used to create", () => {
    expect(boundBuckets(API, "production")).toContainEqual({
      binding: "REFERRAL_CARDS",
      bucket: "mm-prod-referral-cards",
    });
  });
});

type Answer = { status: number; body: unknown };
const ok = (result: unknown): Answer => ({ status: 200, body: { success: true, errors: [], result } });
const refused: Answer = {
  status: 403,
  body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] },
};
const noSuchBucket: Answer = {
  status: 404,
  body: { success: false, errors: [{ code: 10006, message: "The specified bucket does not exist." }] },
};

const expireAfter = (days: number, prefix = "") => ({
  id: `expire-after-${String(days)}-days`,
  enabled: true,
  conditions: { prefix },
  deleteObjectsTransition: { condition: { type: "Age", maxAge: days * DAY } },
  abortMultipartUploadsTransition: { condition: { type: "Age", maxAge: DAY } },
});
const abortOnly = {
  id: "abort-multipart",
  enabled: true,
  conditions: { prefix: "" },
  abortMultipartUploadsTransition: { condition: { type: "Age", maxAge: DAY } },
};

/** Staging's four buckets, each existing with the lifecycle rules given, unless `answers` says otherwise. */
function account(rules: Record<string, unknown[]>, answers: Record<string, Answer> = {}): typeof fetch {
  return (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString();
    const path = url.replace("https://api.cloudflare.com/client/v4/accounts/acct/r2/buckets/", "");
    const [bucket = "", lifecycle] = path.split("/");
    const answer =
      answers[bucket] ?? (lifecycle === undefined ? ok({ name: bucket }) : ok({ rules: rules[bucket] ?? [] }));
    return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status }));
  };
}

const RIGHT = {
  "mm-staging-tryon-uploads": [expireAfter(30)],
  "mm-staging-tryon-results": [expireAfter(30)],
  "mm-staging-client-photos": [abortOnly],
  "mm-staging-referral-cards": [],
};

function check(doFetch: typeof fetch) {
  return checkBuckets({ environment: "staging", accountId: "acct", token: "t", configs: [API], fetch: doFetch });
}

const differences = async (doFetch: typeof fetch) =>
  (await check(doFetch)).filter((finding) => finding.outcome !== "matches").map((finding) => finding.subject);

describe("the live buckets", () => {
  it("match when the try-on buckets expire everything within 30 days and no other bucket expires anything", async () => {
    const findings = await check(account(RIGHT));
    expect(findings).toHaveLength(4);
    expect(findings.every((finding) => finding.outcome === "matches")).toBe(true);
  });

  it("differ when a try-on bucket has lost its rule, or keeps objects longer than 30 days", async () => {
    expect(await differences(account({ ...RIGHT, "mm-staging-tryon-uploads": [abortOnly] }))).toEqual([
      "mm-staging-tryon-uploads",
    ]);
    expect(await differences(account({ ...RIGHT, "mm-staging-tryon-results": [expireAfter(45)] }))).toEqual([
      "mm-staging-tryon-results",
    ]);
  });

  it("do not count a rule that covers only part of the bucket, or is switched off", async () => {
    const partial = { ...RIGHT, "mm-staging-tryon-uploads": [expireAfter(30, "uploads/")] };
    expect(await differences(account(partial))).toEqual(["mm-staging-tryon-uploads"]);
    const off = { ...RIGHT, "mm-staging-tryon-results": [{ ...expireAfter(30), enabled: false }] };
    expect(await differences(account(off))).toEqual(["mm-staging-tryon-results"]);
  });

  it("differ when the photographs bucket would expire a client's photographs", async () => {
    const findings = await check(account({ ...RIGHT, "mm-staging-client-photos": [expireAfter(30)] }));
    const photos = findings.find((finding) => finding.subject === "mm-staging-client-photos");
    expect(photos?.outcome).toBe("differs");
    expect(photos?.detail).toContain("must never expire");
  });

  it("differ when a bound bucket does not exist, and say where it is made", async () => {
    const findings = await check(account(RIGHT, { "mm-staging-referral-cards": noSuchBucket }));
    const cards = findings.find((finding) => finding.subject === "mm-staging-referral-cards");
    expect(cards?.outcome).toBe("differs");
    expect(cards?.detail).toContain("docs/runbook.md");
  });

  it("say once, plainly, that a token which may not read R2 checked nothing", async () => {
    const findings = await check(account(RIGHT, { "mm-staging-tryon-uploads": refused }));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.outcome).toBe("not read");
    expect(findings[0]?.detail).toContain("scripts/check-buckets.ts staging");
  });
});
