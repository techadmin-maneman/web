# 0030. One-time codes for the client app's login

- Status: accepted. Amended 30 September 2026 by [0097](0097-staging-logins-open-reminders-fenced.md): a code no longer checks staging's allowlist at all. Amended 3 October 2026: every code counts against its number and address, technicians have their own ceiling, and the client login needs Turnstile.
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
- **Resending:** `POST /api/auth/otp/resend` (WhatsApp, 30 seconds after the last send) and `POST /api/auth/otp/sms` (30 seconds after the first) put a fresh code on the same challenge. Its count of wrong attempts carries on, so asking again gains a guesser nothing. A challenge sends at most three codes.

**Limits.** Every number counts alike, booked or not. The three are fixed in `src/config/limits.ts` (ADR 0009, rule 6):

- 5 codes per number per day (`OTP_MOBILE_DAILY_LIMIT`);
- 10 codes per address per hour (`OTP_IP_HOURLY_LIMIT`);
- 300 codes in all per day (`OTP_DAILY_CEILING`). Reaching it answers `503 busy` and alerts once.

> **Amended 3 October 2026 (audit findings PS-12 and FLD-27).** Strangers could still spend the codes clients and technicians need: a resend skipped the number's and the address's limits, so one number got 25 codes a day, and 20 numbers nobody knows locked their whole address out until midnight. Now:
>
> - **Every code counts against its number's day and its address's hour**, a resend as much as a first code, whoever holds the number: a login challenge keeps the number's hash (`otp_challenges.mobile_hash`, migration 0078). A challenge sends at most three codes (`MAX_SENDS_PER_CHALLENGE`).
> - **A number nobody knows is answered like any other** and costs nothing more; its address is never refused for it.
> - **Technicians have a ceiling of their own**, 100 a day (`OTP_TECH_DAILY_CEILING`), which only codes to active technicians count against; ops are told when an active technician is refused a code, and the alert closes once he is given one.
> - **Asking for a client login code needs Turnstile**, which the app renders invisibly (`docs/turnstile.md`).

> **Amended 30 September 2026 ([ADR 0097](0097-staging-logins-open-reminders-fenced.md), the owner's ruling "logins open, reminders fenced").** A code is always asked for by the phone that receives it, so staging's allowlist (`MESSAGING_ALLOWLIST`) no longer holds one back: `countCode` and `sendCodeAfterResponse` (`src/http/send-code.ts`) do not call `onAllowlist`. Every number with a booking now has its code sent and counted against the day's ceiling below; only a number nobody here knows still costs its address instead of the ceiling.

> **Amended 25 September 2026 (audit finding REQ-S6-02).** The ceiling was taken before the number was looked up, so about 30 address-hours of random numbers used up the day's 300 and locked out every client login, every technician on a new phone and every number change until midnight. Now:
>
> - **Only a code that is sent counts against the ceiling**, the one clients, technicians and number changes share. A number nobody here knows costs its address instead of the ceiling (below, corrected 30 September 2026: the allowlist no longer excuses a known number from it either).
> - **A number nobody knows costs its address instead:** 20 a day (`UNKNOWN_NUMBERS_PER_ADDRESS_DAILY`, `src/http/send-code.ts`). An address past them is refused every number, known or not, until midnight in India. A refusal only for unknown numbers would tell a caller which numbers are real.
> - Both are read before the number is looked up, so the answer is still the same for every number: `429 rate_limited` from an address past its unknown numbers, and `503 busy` for everyone once the ceiling is reached.
> - A technician's login reads FSM's user list for a number the mirror does not know at most once in ten minutes, however many such numbers are tried. A technician ops have just added in FSM waits at most that long, or until the nightly sync.

**SMS is off until DLT.** `SMS_PROVIDER` is `none` on staging and production; the app offers WhatsApp only (`sms_in_s` is null) and `POST /api/auth/otp/sms` answers `404`. Locally it is `stub`. "none" is not a stub, so production may hold it. The DLT provider (MSG91 is recommended) arrives as a third value, with its OTP template ending in the WebOTP line `@app.maneman.in #<code>`.

**No Turnstile yet.** A code is sent only to a booked number, and each number and address is limited, so a flood of requests sends few codes and charges nothing. It still spends the account's 100,000 Workers requests a day, which every surface shares, and the limits here act only once a request is counted (corrected 4 October 2026; ADR 0009, "Update, 4 October 2026: a flood"). Turnstile comes with the SMS provider, since each SMS is paid for. (Superseded 3 October 2026: see the amendment above.)

**The message text** is `login_code_v1` in `src/config/message-templates.ts`. It is placeholder copy until the owner approves the wording (plan input 5).

## Consequences

- **Evolution's ban risk now covers logins.** If the number is banned, no one can log in until SMS exists. That makes the DLT registration more urgent.
- **New secret:** `OTP_PEPPER`, at least 32 characters, required wherever the client surface is switched on (staging now). It is set with `W secret put OTP_PEPPER --env <env>`.
- **Clean-up:** the sweeper deletes challenges a day after they expire. Erasure voids a person's open challenges.
- **Tests** (`test/worker/client-auth.test.ts`) cover:
  - the same answer, and nothing sent, for unbooked, try-on-only and erased numbers;
  - a code sent to a number off staging's allowlist, since ADR 0097 a code answers whoever asked for it;
  - each rule, named by its words in `src/policy/one-time-code.ts`;
  - the per-number, per-address and daily limits;
  - the Origin check;
  - no code or number in the logs.

  `test/node/policy-one-time-code.test.ts` covers the rules' own functions.
