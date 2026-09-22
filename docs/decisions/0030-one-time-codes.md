# 0030. One-time codes for the client app's login

- Status: accepted
- Date: 2026-09-22

## Context

The prompt's rules (`src/policy/one-time-code.ts`):

- six digits, sent on WhatsApp;
- after 30 seconds the client may choose SMS instead;
- five wrong attempts void the code;
- the WhatsApp resend has a 30-second cooldown;
- a code works for ten minutes, with rate limits per number and per address.

Login is open to anyone with a booked consultation or a later appointment. The prompt also says `POST /auth/otp` answers `404 not_recognised` for a number with no booking, which the design's screen A3 shows.

Two rulings and two constraints bear on it:

- **WhatsApp stays on Evolution** (ADR 0025, item 1), which has no authentication template. A code is an ordinary message, with the ban risk ADR 0016 records.
- **The owner accepted neutral wording on A3** (22 September 2026). A screen that says "We have no booking on this number" tells anyone who types a number whether it belongs to a hair-system client.
- **SMS needs a DLT-registered provider** (plan input 4), which will take weeks.
- **The FSM mirror, which knows who has an appointment, arrives in P2-M2.**

## Decision

**The answer never says whether a number has a booking.** `POST /api/auth/otp` answers `202` with the same body, and in the same time, for every number:

- **A number with a booking** gets a challenge holding its code's hash, and the code is sent on WhatsApp.
- **Any other number** gets a challenge that holds no code. Nothing is sent, and no code opens it. Wrong guesses count against it exactly as against a real one.
- **The code is sent after the response has gone** (`waitUntil`), so a real send does not take longer to answer than a decoy.

The app's second screen then says a code is on its way if the number has a booking. It carries A3's help, "book a free consultation" and "message us", beneath. **This departs from the prompt's `404 not_recognised`** at the owner's ruling (ADR 0025).

**Who counts as booked.** A person whose Phase 1 booking has a proposed visit date, and who is not erased (ADR 0025, item 16). P2-M2 moves this to FSM's appointments.

**The code.**

- **Generation:** six digits from `crypto.getRandomValues`, with no digit likelier than another.
- **Storage:** only `HMAC-SHA256(OTP_PEPPER, challenge ID : code)` is stored, compared in constant time. It is never logged, and neither is the number.
- **Checking:** each check counts the attempt before comparing, so parallel guesses cannot share one. The fifth wrong code voids the challenge. A right code closes it and opens a session (ADR 0029).
- **Resending:** `POST /api/auth/otp/resend` (WhatsApp, 30 seconds after the last send) and `POST /api/auth/otp/sms` (30 seconds after the first) put a fresh code on the same challenge. Its count of wrong attempts carries on, so asking again gains a guesser nothing. A challenge sends at most five codes.

**Limits.** Every number counts alike, booked or not:

- 5 codes per number per day (`OTP_MOBILE_DAILY_LIMIT`);
- 10 codes per address per hour (`OTP_IP_HOURLY_LIMIT`);
- 300 codes in all per day (`OTP_DAILY_CEILING`). Reaching it answers `503 busy` and alerts once.

On staging, codes go only to the allowlisted handsets (`MESSAGING_ALLOWLIST`), and every other number is answered the same.

**SMS is off until DLT.** `SMS_PROVIDER` is `none` on staging and production; the app offers WhatsApp only (`sms_in_s` is null) and `POST /api/auth/otp/sms` answers `404`. Locally it is `stub`. "none" is not a stub, so production may hold it. The DLT provider (MSG91 is recommended) arrives as a third value, with its OTP template ending in the WebOTP line `@app.maneman.in #<code>`.

**No Turnstile yet.** A code is sent only to a booked number, and each number and address is limited, so a flood of requests sends little and costs nothing. Turnstile comes with the SMS provider, since each SMS is paid for.

**The message text** is `login_code_v1` in `src/config/message-templates.ts`. It is placeholder copy until the owner approves the wording (plan input 5).

## Consequences

- **Evolution's ban risk now covers logins.** If the number is banned, no one can log in until SMS exists. That makes the DLT registration more urgent.
- **New secret:** `OTP_PEPPER`, at least 32 characters, required wherever the client surface is switched on (staging now). It is set with `W secret put OTP_PEPPER --env <env>`.
- **Clean-up:** the sweeper deletes challenges a day after they expire. Erasure voids a person's open challenges.
- **Tests** (`test/worker/client-auth.test.ts`) cover:
  - the same answer, and nothing sent, for unbooked, try-on-only and erased numbers;
  - the allowlist;
  - each rule, named by its words in `src/policy/one-time-code.ts`;
  - the per-number, per-address and daily limits;
  - the Origin check;
  - no code or number in the logs.

  `test/node/policy-one-time-code.test.ts` covers the rules' own functions.
