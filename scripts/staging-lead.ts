// Books one test consultation on staging through the real API, as the site's form does: past Cloudflare Access
// (service token) and Turnstile (Cloudflare's dummy token, which only staging accepts). It proves the booking path
// reaches Zoho: the lead in the CRM, and the consultation in FSM, which staging marks "Staging test:" because it
// shares the owner's real org (docs/decisions/0025-phase-2-conflicts-register.md, item 26). The day is the last the
// form offers, the furthest from any real visit. Run from the staging-lead workflow, which holds the Access secrets.
//
// The booking's name, "Staging test", is one of our own scripts' (isStagingTestRecord,
// src/policy/staging-test-records.ts), so a booking confirmation on the consultation reaches only a number also on
// staging's allowlist, whatever it is (ADR 0097). STAGING_TEST_MOBILE, when set, is used instead of a random
// number, which is otherwise still the default: either way, the rule above keeps a stranger's number silent.
//
//   node scripts/staging-lead.ts --pincode 122018 --window morning

import { parseArgs } from "node:util";
import { consultationBody, lastBookableDay, testMobile } from "./lib/test-booking.ts";

const WINDOWS = ["morning", "afternoon", "evening"] as const;
/** Cloudflare Access's service token, for staging's host. */
const ACCESS = {
  "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID ?? "",
  "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET ?? "",
};

const { values } = parseArgs({
  options: {
    pincode: { type: "string", default: "122018" },
    window: { type: "string", default: "morning" },
    base: { type: "string", default: "https://staging.maneman.in" },
  },
});
const window = WINDOWS.find((each) => each === values.window);
if (window === undefined) {
  console.error(`--window is one of ${WINDOWS.join(", ")}`);
  process.exit(2);
}

// The form asks first whether we come; the booking is refused for a pincode we do not serve.
const checked = await fetch(`${values.base}/api/pincodes/${values.pincode}`, { headers: ACCESS });
const place = (await checked.json().catch(() => null)) as { served?: boolean; city?: string | null } | null;
if (!checked.ok || place?.served !== true || typeof place.city !== "string") {
  console.error(`${String(checked.status)}: ${values.pincode} is not a pincode staging serves`);
  process.exit(1);
}

const mobile = process.env.STAGING_TEST_MOBILE ?? testMobile();
const response = await fetch(`${values.base}/api/consultation`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), ...ACCESS },
  body: JSON.stringify(
    consultationBody({
      name: "Staging test",
      mobile,
      pincode: values.pincode,
      city: place.city,
      date: lastBookableDay(),
      window,
    }),
  ),
  redirect: "manual",
});

console.log(`${String(response.status)} ${await response.text()}`);
console.log(`mobile …${mobile.slice(-4)}`); // never printed in full: it may be a real person's, from STAGING_TEST_MOBILE
if (response.status === 409) console.log("That window is taken or gone: run it again with another --window.");
if (response.status !== 201) process.exit(1);
