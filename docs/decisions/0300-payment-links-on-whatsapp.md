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
   amount, what it pays for, and when it closes. Sending it again sends the same token.
2. **`maneman.in/pay/<token>` sends the client on to Razorpay** while the link is open; once it has closed, or for a
   token we never made, the site says the link has closed. A token is 128 random bits; an address that misses
   repeatedly is refused for the hour, as invite codes are.
3. **The message is `payment_link_v1`**, a transactional template with a "Pay now" button on that address. It goes
   whatever the client's consent to visit messages, as a receipt does, and through the allowlist as any message ops'
   action sends.
4. **Until WhatsApp approves the template, MSG91 does not send it** (`AWAITING_APPROVAL`,
   src/config/approved-templates.ts): the message is skipped, not failed, so no "Message not delivered" task is made.
   Approved, the template leaves that list.

## Consequences

- Razorpay's SMS still goes, as before; the WhatsApp message is beside it, not instead of it.
- A button's address is production's origin, so a staging message's button opens production's site, which knows no
  staging token and says the link has closed, as a staging stop link already does.
