# 0288. Attribution and conversions

- Status: accepted, on the owner's brief and rulings of 20 November 2026
- Date: 2026-11-20
- Topic: Platform
- Amends [0148](0148-the-channel-rule.md) on how a channel is found, [0150](0150-spend.md) on what spend is entered,
  and [0138](0138-strangers-in-the-inbox.md) on what Care's "How they found us" records

## Context

Spend starts on Google Ads, Meta, society activations, referrals, WhatsApp and the phone. The owner asked that every
paid first fit, and every rupee a client pays after it, be put down to the source that won the client, from our own
tables; and that Google and Meta be told of the consultations and payments that follow a lead, so they bid for clients
who are fitted rather than for forms filled.

The site kept the first page of a browser tab's visit only (sessionStorage), sent it with a booking, and stored it on
the lead. It kept no visitor from one day to the next, no last touch, and none of Google's iOS click IDs or Meta's
cookies; a WhatsApp chat or a call carried nothing; and nothing was sent to either platform from the server.

## Decision

1. **A visitor, and their touches.** The site's Worker gives each browser a first-party visitor cookie, set by the
   server so Safari keeps it, for 13 months, on `.maneman.in` so the client app's requests carry it, named for its
   environment. The page sends what each landing carried to `POST /api/landings` once for the visitor's first page and
   again for any landing a campaign put something in, a second after the page has loaded or at the visitor's first tap
   (so it never counts against the page's first paint), and as it goes, outliving it; the first landing and the latest
   campaign landing go again from later pages until the API has answered them; a landing sent again, under the page's
   own key for it, records nothing more; crawlers, which run no script, write nothing. Each is a **touch**:
   the campaign tags, Google's three click IDs, Meta's click ID and cookies (its click cookie built from the click ID
   where the browser had none), the page before, the landing page, any code of ours, and the visitor's answer to the
   cookie bar. A WhatsApp chat that opens with the visitor's reference ("Ref M7K2Q9XP"), or from a click-to-WhatsApp ad,
   and a call ops take, are touches too.
2. **The record is the person's, by their number.** `people` already holds one row per number; `person_attribution`
   holds, beside it, the first touch, the last touch, the client's channel and their last touch's channel. The first
   touch is set once and never moved, but by history: the hourly job gives each lead from before touches one, from what
   it was saved with, and a touch so given that came before the kept first is the first, with the channels of what the
   client did since corrected to it. The last touch moves only for a touch a campaign put something in. A number we
   hold that comes again is a new touch, nothing more. `leads` keeps a row per lead, as before, now with its touch.
   Migration 0227 records what clients did before conversions were (their first consultation booked and done, each
   visit's payment) as conversions never sent, so the report counts it.
3. **The channel rule.** A touch's channel is the first of: a friend's or a partner's code, a society's code, a Google
   click ID (gclid, gbraid, wbraid), a click-to-WhatsApp ad, the campaign tags (a paid medium from Google or Meta, an
   offline medium, a search or social source), Meta's click ID alone (organic social: Meta adds it to unpaid links),
   the page before (a search engine, a social site, any other site), what a call was put under, a chat or a call with
   nothing else, Direct. A client's channel is their first touch's, unless a code reached us before their first
   consultation was booked: then the code's. Four channels join the seven: Society activations, Other sites, WhatsApp,
   Phone. The inputs are kept, so a channel can be worked out again.
4. **What a client says is kept apart.** Ops record how the client heard of us (a fixed list, with words of their own
   for "other") on the client's page, asked at the consultation, where the Tasks board shows it missing (How they
   heard of us, Customer Care's, for a client whose first consultation was done within the board's lapse days). It never
   enters the channel. Care's "How they found us", which did, is now this answer.
5. **A call.** A lead ops take from a call needs a channel picked before it is saved. The pick is the call's own touch
   (`declared_by` ops); a tracking number per channel will one day put it there instead (`declared_by` number). It
   counts in the channel rule, after anything a click or a tag says, which a call never has. Such a lead is answered
   on the call and never chased, as a WhatsApp lead is (0138): its CRM record waits with the WhatsApp leads' until the
   org has their values.
6. **A chat.** An inbound message's reference, or a click-to-WhatsApp ad's referral, is a touch on the chat's number at
   once. Where the number is one of our people's, it is theirs at once; otherwise it becomes theirs when Care save or
   link the chat (0138), or the number books. No person is made from a message alone.
7. **Campaign links.** Growth make a society activation (its society, pincode, day and costs) or an offer link (its
   name and tags) in the console. Each is a short link on our domain, `/s/<slug>` or `/o/<slug>`, which sends the
   visitor to `/book` with its tags and its code, and a QR code of it. A society's costs are spend entries on its link.
   A link may carry one of Finance's discount codes, taken off the first fit by itself as a partner's is (0125): a
   society's only for an address in its pincode. A code the client typed comes first, then a partner's, then the
   latest link's. Neither /book nor the invite's page asks for a code: codes come only by link.
8. **Conversions.** Five events are recorded once each, in `conversions`, with the client's channels at that moment:
   a lead left on /book's first step (`lead_submit`), a consultation booked (`consult_booked`), one done
   (`consult_done`), a first fit paid (`first_fit_paid`, the earliest visit payment on the client's first first fit
   still standing, one a client) and any other visit's payment (`service_paid`; a late fee is none), the last two worth
   what was paid before GST, read when sent. The last four are recorded by the statements that follow every write to a client's visits
   and every payment captured, in our own tables, and the cron sends them every five minutes, so no payment, booking or
   visit path calls a platform, and Razorpay's webhook, which only queues (0202), is never held by one.
9. **Sending them.** Each conversion waits in its row for each platform, tried again 1, 5, 30, 120 and 720 minutes
   after a failure and then given up, by its event ID, so it is sent once. A refusal of our account rather than the
   event (a token lapsed or deleted, access gone, an ID the platform does not know) holds every conversion of that
   platform due an hour, no try spent, and tells ops once, until a send goes through. Nothing that happened before the
   day sending began (`CONVERSIONS_FROM`), nor anything recorded more than 7 days after it happened, is sent: it is
   history its clients were never told would be shared. Meta is sent through the Conversions API: a lead from the
   website, with the event ID the browser's Pixel used, so Meta counts the two once; a booking as Schedule, told as
   made on the website, in a chat, on a call or by our system, as it was (owner, 20 November 2026); a consultation
   done, a first fit (Purchase) and a service paid from a physical store. Each carries the hashed number
   and first name, and, where the visitor did not decline the cookie bar, Meta's cookies, the address and the browser.
   Google is sent through the **Data Manager API**, which carries Google's offline conversions and enhanced
   conversions for leads since 2026, under a service account: the click ID where there is one, the hashed number always,
   and where it happened (a booking as WEB, MESSAGE, PHONE or OTHER as it was made, a visit or a payment as in
   store). A lead reaches Google from GA4 instead.
   Neither platform hears of a test record, and an event too old for it (7 days for Meta's website events, 62 for its
   store events, 90 for Google) is let go.
10. **Test mode.** A setting runs the sends off, in test mode (Meta's Test Events code, Google's `validateOnly`), or
    live. Staging may only be off or in test.
11. **Spend is ours.** Spend may be put under any channel, Google's and Meta's included, by the day, typed or taken
    from the ad accounts' CSV; an API can feed it later through the same rows. The figures read only our own rows, never
    a platform's numbers; Zoho's ad connectors must not be added for spend, or it counts twice.
12. **The figures.** The console's Funnel becomes the report the brief asks for: spend, leads, consultations booked and
    done, first fits, the cost of each, first-fit revenue and its return on spend, each client cohort's revenue 30, 90
    and 180 days from their first fit, by the client's channel or their last touch's, and what clients said beside the
    channel we found, by week or month. The nightly copy carries the same channels to Zoho.
13. **What the visitor is told.** /book's first step says, under its button, that the details are used to contact the
    client and shared, hashed, with Google and Meta to measure our ads, with the privacy policy linked; that step's
    touch keeps the notice's version, a number we already hold's included, and the touch's time is when it was shown.
    The privacy policy has a section on it. The cookie bar's consent now starts granted (owner, 20 November 2026);
    Decline switches the browser's tags off, and the browser tells the API at once, which blanks Meta's cookies, the
    address and the browser on every touch that browser made and marks them declined, so nothing kept before the
    Decline is sent either; it marks the browser too, so a touch from that browser that reaches the API after it,
    unless it says the visitor has since accepted, is declined as well, read in the touch's own insert; and the page
    sends the Decline again once a landing report going when it was made has answered.
14. **What the browser sends.** GA4 records `generate_lead` when /book's first step is sent, with the event ID, and the
    hashed number for Google's enhanced conversions; Google Ads imports it from GA4, so the site carries no Ads tag of
    its own. `tryon_complete`, `whatsapp_click` and `call_click` go to GA4, the last two to the Pixel as Contact. A
    try-on is no longer a Pixel Lead. Browser IDs stay in `site/src/lib/analytics-ids.ts`: they are public and the
    site's policy is built from them. Every server ID and token is a Worker secret.

## Consequences

- Visitors never named, and their touches, go 13 months after their last; a touch's address and browser go 90 days
  after it. An erasure blanks a person's touches and attribution.
- Society activations' figures come from the touches their codes made, and from the spend on their links.
- What a platform hears of a refund is not sent: our own figures take refunds off; the platforms' do not.
- A first fit paid at booking, then cancelled with a refund and booked again, keeps `first_fit_paid` on the refunded
  payment, and the new one is `service_paid`: the report then counts that client's first-fit revenue near nothing.
  It is rare, and Meta and Google have heard of the first payment already; it is left as it is.
- /book does not prove the number, so a visitor can put their own browser's touches on another person's number: Meta
  may then hear that browser with that person's hashed number, and that person's data export shows it. Nothing comes
  back to the visitor; proving the number at /book's first step would end it.
- Tests: `test/node/policy/channels.test.ts`, `test/node/api/lib-ad-match.test.ts`, `test/worker/attribution/`,
  `test/worker/platform/guard-conversions.test.ts`, `test/worker/ops/growth-acquisition.test.ts`,
  `test/dom/ops-attribution.test.ts`.
