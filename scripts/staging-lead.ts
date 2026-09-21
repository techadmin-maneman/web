// Creates one test lead on staging through the real API: past Cloudflare
// Access (service token) and Turnstile (Cloudflare's dummy token, which only
// staging accepts). Used to prove the lead path reaches Zoho. Run from the
// staging-lead workflow, which holds the Access secrets.
//
//   node scripts/staging-lead.ts --city Gurgaon --window weekday_am

import { parseArgs } from "node:util";
import { TURNSTILE_TEST_TOKEN } from "../src/providers/turnstile.ts";

const { values } = parseArgs({
  options: {
    city: { type: "string", default: "Gurgaon" },
    window: { type: "string", default: "weekday_am" },
    base: { type: "string", default: "https://staging.maneman.in" },
  },
});

// A fresh test number each run, so the per-number daily limit never trips: 9 then nine random digits.
const mobile = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;

const response = await fetch(`${values.base}/api/lead`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID ?? "",
    "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET ?? "",
  },
  body: JSON.stringify({
    name: "Staging test",
    mobile,
    city: values.city,
    first_choice_window: values.window,
    loss_extent: "crown",
    consent: true,
    turnstile_token: TURNSTILE_TEST_TOKEN,
  }),
  redirect: "manual",
});

const text = await response.text();
console.log(`${String(response.status)} ${text}`);
console.log(`mobile ${mobile}`); // a random test number, not a person's
if (response.status !== 201) process.exit(1);
