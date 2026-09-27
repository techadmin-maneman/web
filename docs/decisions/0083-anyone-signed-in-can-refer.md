# 0083. Anyone signed in can refer

- Status: withdrawn by the owner on 27 September 2026, the day it was made; [0048](0048-referrals.md) stands
- Date: 2026-09-27
- Records item 64 of [0025](0025-phase-2-conflicts-register.md)

## Context

The owner tried the client app on staging on 27 September 2026 and asked: "How can a user refer someone? There is nothing in the referral page."

The Refer tab showed board F1 to a fitted client only. A lead, or a client with nothing booked, saw an empty state, as the front-end prompt draws board B2: "The Photos, Payments and Refer tabs can be reached but show their empty states." Two things would make the invite untrue before a first fit:

- the message sent with the link says "Had my hair system fitted at home by these people";
- the card choice (F2) offers the client's own first fit's photographs, which do not exist yet.

## Decision, as made

Offered the choice, the owner first ruled that **everyone signed in can share an invite**. PR #139 built it and it went live on staging:

- Refer and its tracker for every signed-in client;
- before a first fit, the house card only, with a placeholder message true for someone not yet fitted;
- the rewards unchanged: the friend rewarded once fitted, and the referrer's 3 visits with the friend's.

It also made referring oneself easier. Someone new could book a free consultation on a second number, sign in with it, and invite their first number; the fraud holds catch that pair only through a shared address, UPI handle or number.

## Withdrawn

The same day, reminded that Refer opened only after a first fit because the invite's words are untrue before one, the owner said: "Revert to that."

- PR #139 is reverted: Refer shows the invite to fitted clients only, and everyone else sees board B2's empty state, as [0048](0048-referrals.md) and the board have it.
- Open point 145 (the pre-fit message, and the self-referral gap) went with it, and is settled as withdrawn.
- The API never asked whether the referrer was fitted, and still does not: the gate is the app's, as before.
