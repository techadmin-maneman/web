# 0300. Payment links on WhatsApp, through our own address

- Status: accepted
- Date: 2026-11-23
- Topic: Money and Books

## Context

A payment link ops make, for a held booking, a custom order or a one visit's charge, reaches the client only as
Razorpay's SMS. Clients read WhatsApp. The owner ruled on 22 November that links go on WhatsApp too, and on 23
November that the message's button opens an address of ours rather than Razorpay's.

A WhatsApp template's button has a fixed address with one part a message fills in. Razorpay's links are short links on
rzp.io whose form has changed (`/i/` became `/rzp/`), and Meta is wary of link shorteners in templates. Every button we
have approved is our site's origin followed by a path.

## Decision

1. **Each link made is kept under a random token** (`pay_links`, migration 0233): the person, Razorpay's address, the
   amount, what it pays for, and when it closes. A link found made by a try whose answer never came is kept and sent
   the same way. Sending it again sends the same token. Failing to queue the message never fails the link: Razorpay has
   texted it.
2. **`maneman.in/pay/<token>` sends the client on to Razorpay** while the link is open. Otherwise mm-site's Worker
   sends them to a page of ours by an address without the token, so no page's tags, history or error report ever
   holds it: `/pay`, that the link has closed, where mm-api says it is not open; `/pay/again`, that it could not be
   opened just now, where mm-api could not say, since it may still be open. Both offer a chat with us, opened with
   their own words. A page the Worker failed on at a token's address goes to `/pay/again`. A token is 128 random
   bits, which is what keeps it from being guessed. An open one is always answered, so clients behind one carrier's
   address are never kept from theirs; a miss is counted against the address, which past its misses for the hour is
   answered 429 rather than 404, as an invite code's are. A link paid, or cancelled at Razorpay, still opens while it
   is open, and Razorpay's page says so.
3. **The message is `payment_link_v1`**, a transactional template with a "Pay now" button on that address. It goes
   whatever the client's consent to visit messages, as a receipt does, and through the allowlist as any message ops'
   action sends. It is WhatsApp's alone: the client app's cards already show a held booking's and a custom order's
   link, so no alert is written beside it (migration 0233 makes 0211's triggers again without it).
4. **Until WhatsApp approves the template, MSG91 does not send it** (`AWAITING_APPROVAL`,
   src/config/approved-templates.ts): the message is skipped, not failed, so no "Message not delivered" task is made.
   Approved, the template leaves that list. It is held back in code rather than by a console setting: the console's
   settings hold figures, not switches, and this one is turned once, by us, when WhatsApp approves.

## Consequences

- Razorpay's SMS still goes, as before; the WhatsApp message is beside it, not instead of it.
- A button's address is production's origin, so a staging message's button opens production's site, which knows no
  staging token and says the link has closed, as a staging stop link already does.
