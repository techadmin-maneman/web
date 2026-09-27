# 0083. Anyone signed in can refer

- Status: accepted
- Date: 2026-09-27
- Amends [0048](0048-referrals.md): who may share an invite; adds item 64 to [0025](0025-phase-2-conflicts-register.md)

## Context

The owner tried the client app on staging on 27 September 2026 and asked: "How can a user refer someone? There is nothing in the referral page."

The Refer tab showed board F1 to a fitted client only. A lead, or a client with nothing booked, saw an empty state, as the front-end prompt draws board B2: "The Photos, Payments and Refer tabs can be reached but show their empty states." Two things made the invite untrue before a first fit:

- the message sent with the link says "Had my hair system fitted at home by these people";
- the card choice (F2) offers the client's own first fit's photographs, which do not exist yet.

The API never asked. `GET /api/refer` makes the code the first time any signed-in client asks, and the grant looks only at the friend (ADR 0048).

Offered the choice, the owner ruled on 27 September 2026 that **everyone signed in can share an invite**:

- before a first fit they get only the house example card;
- the invite message no longer says "Had my hair system fitted";
- the friend is still rewarded only once fitted, and the referrer's 3 visits arrive at the same time.

## Decision

**Refer and its tracker are every signed-in client's.** A lead and a client with nothing booked see board F1:

- the promise;
- their credit, when they have one;
- the line about the credits of an invite they came through (ADR 0074);
- "No other discount applies.";
- Share an invite, and See who has been fitted.

The tracker (F5, F6) is theirs too.

**Before a first fit, the invite is the house card.** A client not yet fitted has no photographs to put on a card. "Fitted" is the rule Home reads: a first fit, a service visit or a replacement done (`clientStateOf`). So Share an invite skips F2's choice and opens on the preview (F4), with the house card:

- there is no "My before and after" they could not pick;
- nothing is asked about consent, since nothing of theirs is sent;
- the photographs are not fetched.

From their first fit on, the sheet opens on F2 as before.

**Their message is true for them.** Beside the link, a client not yet fitted sends "These people fit hair systems at home, across Delhi NCR. Worth a look — {link}".

- It is a placeholder (`refer.preview.messageBeforeFit` in `apps/app/src/content.ts`; `docs/open-points.md`, item 145).
- Its area is held to the site's by `test/node/app-invite-preview.test.ts`, as the preview's is (ADR 0025, item 14).
- A fitted client keeps "Had my hair system fitted at home by these people. Worth a look — {link}".
- The preview above the message is the landing's own for every invite, and names the client only with their consent to the cards' lines (ADR 0048).

**The rewards are unchanged.** Nothing in the grant, the fraud holds or the reward asks whether the referrer is fitted (`src/domain/referral-grants.ts`, `src/policy/fraud-holds.ts`, `src/policy/referral-reward.ts`), so no rule changes:

- when the friend's first fit closes as done, both sides get 3 service-visit credits, in one batch;
- attribution is as before: the friend must be new, not the referrer and not already fitted;
- a credit pays for a service visit, which a client can book only once fitted (`bookableTypes`), so a referrer not yet fitted keeps theirs until their own fit;
- the credits expire 365 days after the grant, as every credit does.

**The landing reads a lead's invite as any other.** `GET /api/r/{code}` answers valid, with the house card and, without the card consent, no name.

## Consequences

- The departure from board B2 is ADR 0025, item 64. `docs/fidelity-method.md` records it, with the pairs `f1-refer-before-fit` and `f4-share-before-fit`.
- Held by:
  - `e2e/app/refer.e2e.ts` ("a client not yet fitted shares the house card …"), which follows the copied link to the landing;
  - `test/worker/referrals.test.ts` ("a referrer not yet fitted");
  - `test/node/app-invite-preview.test.ts`.
- **Referring oneself is easier, and the fraud holds catch only part of it.** For the owner (ADR 0025, item 64; `docs/open-points.md`, item 145):
  - Someone new can book a free consultation on a second number, sign in with it, and send the invite to their first number. Fitted on the first number, they collect the friend's 3 service visits. The second number holds 3 more, which it can spend only once it is fitted too.
  - Until this ruling the app showed the invite to fitted clients only.
  - The holds catch the pair only if they share an address (the same first line and pincode), a UPI handle, or a number through a confirmed change. A consultation is free, so the second number has paid nothing and shares no UPI handle. Only a shared address stops it.
  - A further hold is possible, for a grant whose referrer has not been fitted, or has had no consultation. None is built.
