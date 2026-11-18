# 0279. One rule for paying, and the tagline as written

- Status: accepted
- Date: 2026-11-19
- Topic: Money and Books
- Amends [0257](0257-razorpay-only.md) on the Payments page's note, and [0213](0213-the-sites-second-copy-round.md) on
  the hero's last phrase

## Context

The client app's Payments page ended on ADR 0257's line, "Every payment goes through Razorpay: in the app when you
book, or by a Razorpay link we text you. Technicians never take cash or UPI.", shown while self-serve booking is on.
Until 0257's items come into force, production runs as ADR 0209 says: a paid visit ops book is paid by UPI to Mane Man
at the visit, and its booking message says so. A client could read both, and a UPI receipt sits in the same list as the
line saying no payment is UPI. The app is not told whether Razorpay is on, and self-serve booking off does not mean it
is off, so it cannot choose a line by the way of paying in force.

The brand writes its tagline "Be the Main Man, again!" everywhere. The site wrote it "Be the Main Man again.": the
hero's last phrase (0213, item 7) and the first fit's step in "How it works".

## Decision

1. **One rule, in every way of paying.** The note reads "Every payment goes to Mane Man, never to a technician." It
   names no way of paying, so it holds in the app, by a link and by UPI at the visit alike, and the page shows it
   whether self-serve booking is on or off (`apps/app/src/content/payments.ts`). The client prototype, read-only as
   received, keeps 0257's line; the build departs from it here.
2. **The tagline as the brand writes it**, "Be the Main Man, again!", in the hero's turning line, in "How it works" and
   on the site's boards. On a phone it may take two lines, as the hero's longer phrases do (ADR 0264).

## Consequences

- Payments says the same thing before and after Razorpay is the only way to pay; nothing changes when 0257 comes into
  force.
- The Words page shows the changed lines as not yet read by a copy review until the next one.
