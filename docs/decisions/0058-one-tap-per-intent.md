# 0058. One tap per intent

- Status: accepted
- Date: 2026-09-24
- Follows [0057](0057-one-payment-per-tap.md), which fixed the one place where this could charge a client

## Context

ADR 0057 fixed a double tap in the booking sheet and swept the rest of the client app for the same shape: **an await in a handler whose button stays live**. It found six more and changed none of them, because none can take a client's money. They are changed here.

Two of the six are worse than a wasted request, and it is not the money that makes them so.

**A second login code can lock a client out.** `POST /api/auth/otp` makes a new challenge every time. The app holds the newest, so the second tap voids the code the client is waiting for, and both taps come off `OTP_MOBILE_DAILY_LIMIT` for that number. A client who taps twice a few times has spent their day's codes on codes they never used. The same screen's two other buttons — Resend on WhatsApp, Send by SMS instead — already took `busy`; the third was missed.

**A second grievance is a permanent record about a real person.** Each row ops see carries its own answer-time clock under the DPDP rules (ADR 0049), so one client's one concern becomes two obligations, and the ops screen being built for them would show one person asking twice.

**A second consent row can never be taken back.** `consents` is append-only by trigger (migration 0009), so a duplicate written by a double tap on board F3's Allow stands for good in the record that is the legal one.

The other three cost work, money or patience and leave nothing false behind: a withdrawn-and-restarted number change (four codes for one intent), a verification attempt out of a small budget, and a second billed Place Details resolution against a Places session token that was meant to close once (ADR 0054).

**All six were reproduced in the browser before anything was changed**, as two taps inside one held-open round trip. Requests sent, before and after:

| Where                                             | Before | After |
| ------------------------------------------------- | ------ | ----- |
| `login/CodeScreen.tsx` — Send a new code          | 2      | 1     |
| `profile/AccountCards.tsx` — Start the change     | 2      | 1     |
| `profile/AccountCards.tsx` — Check the codes      | 4      | 2     |
| `profile/AddressSection.tsx` — Save               | 2      | 1     |
| `profile/AccountCards.tsx` — Send (grievance)     | 2      | 1     |
| `refer/ShareSheet.tsx` — Allow for referral cards | 2      | 1     |

Checking the codes sends one request per number, so one tap is two and two taps are four. Every button was live while its first request was in flight.

## Decision

**Every one of the six is guarded in the app, by the ref-and-`disabled` pair ADR 0057 settled on**, now a hook — `apps/app/src/lib/useOneAtATime.ts` — rather than six copies of it. The ref is what holds: `busy` is state and only reaches a button's `disabled` on the next render, so a tap in that gap would otherwise get through. The `disabled` is what the client sees, and the form or sheet carries `aria-busy` so a screen reader is told it is working rather than re-reading a problem the client has already acted on.

**Two of the six are also made safe on the server, and only those two.** The test is what a second request would leave behind. A burnt OTP attempt and a withdrawn number change are annoying and self-correcting; a consent row and a grievance are permanent records about a person, and no guard that lives in a browser can be the thing that prevents them.

**A consent ledger records answers, not repeats.** `switchConsent` writes only when the purpose's latest row does not already hold this answer under this notice. The write settles it, rather than a read before it, so two requests in one moment cannot both find the purpose unswitched and both record it. A request that changed nothing is answered with the date the ledger holds, not with its own moment — the client is told when they agreed, which is not necessarily now.

The notice version is part of the key, not just the answer. The referral-card notice has already gone from v1 to v2, and a client agreeing again under wording that has changed is agreeing to something new; the ledger has to say so. Dropping that would be a hole in the legal record, not a saved row.

**One open grievance per client per wording.** `POST /api/grievances` inserts `WHERE NOT EXISTS` an open grievance of the same person with the same words, and a request that does not win is answered with the grievance the winner raised — so both taps name one concern, ops are alerted once, and one clock runs. The same words again, once ops have answered, are a second concern and a second clock: the key is the **open** one, so a client whose complaint was not fixed can raise it again in the same words.

**No idempotency key anywhere here.** `src/http/idempotency.ts` and `X-Client-Event-Id` exist for writes with no natural key — a lead, a job event — and ADR 0057 rejected one for a booking because the hold was already that key. Both writes guarded here have one too: a purpose has exactly one current answer per person, and a client has at most one open grievance in any given words. A client-supplied key would add a table, a 24-hour replay window and a reservation that a dying worker could strand, to enforce something the rows already say.

**The other four are the app's alone, and the reasons differ:**

- **The fresh login code.** The server cannot tell a second tap from a client who genuinely wants another code, and that is the same request. What it costs is bounded by the per-number daily limit that already exists, and it resets.
- **Starting the number change.** `POST /api/number-change` documents that starting again withdraws the last one, which is how a client corrects a mistyped number. A server that de-duplicated could not tell that from a double tap, and would break the correction to save two codes.
- **Checking the codes.** A spent attempt out of five, on a code that can be sent again.
- **Saving the address.** A duplicate leaves a replaced row in the client's own address history and one Geocoding call inside `GEOCODE_DAILY_CEILING`, which refuses rather than spends. Skipping the call by reusing the coordinate we already hold was considered and refused here: Google's B.6.3.2 permits the indefinite cache "only where the cache is not used as a replacement for making an additional call to the Services", and ADR 0054 describes the flow as geocoding once per address saved. That is a ruling about money and licence terms rather than about a double tap, and it is open point 65.

## Consequences

- **A client cannot lock themselves out of their own login by tapping twice**, which was the worst of the six and the only one that could stop someone using the app at all.
- **Ops see one grievance per concern**, whatever the client's thumb did, and the screens being built for them can trust the row count.
- **The consent ledger stops growing rows that say nothing.** The append-only triggers are unchanged: the change is that a repeat is never written, not that one can be removed.
- **A repeat consent switch is one extra read**, on the path that wrote nothing, to answer with the date the ledger holds. The path that writes is unchanged.
- **The hook is where this idiom now lives**, and a handler that awaits the API without one looks wrong beside its neighbours. `BookingSheet` keeps ADR 0057's own ref rather than being rewired: its `busy` is shared with a second handler that is deliberately not guarded, and the one path that takes a client's money is not the place to save four lines.
- **The disabled buttons are visible.** `profile.module.css` and `refer.module.css` gain a `:disabled` on their primary and secondary, from the tokens `booking.module.css` already uses. The login screen's links stay unstyled when disabled, as its two existing `busy` links already were.
- **What is still only reasoned:** that the browser's two taps and the server's true concurrency are the same defect. As in ADR 0057, the race window is the width of the live API call, and against the local stubs that is microseconds. The two halves are reproduced separately — the taps in Playwright, the simultaneous writes in the worker suite — and joined by that latency rather than by one run showing both.
