# Tracking: events, campaign tags and campaign links

How a client's first visit, lead, consultation and payments are put down to the channel that brought them, and what
Google and Meta are told. The decisions are [ADR 0288](decisions/0288-attribution-and-conversions.md); this page is
the working reference.

## The events

Each event has one `event_id`. Where a browser copy and a server copy are both sent, they carry the same ID, so Meta
counts the two once.

| Event                           | Fired from                                                 | Goes to                                                                                                 |
| ------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `page_view`                     | the browser, every page                                    | GA4                                                                                                     |
| `tryon_complete`                | the browser, when a try-on look is made                    | GA4                                                                                                     |
| `whatsapp_click`                | the browser, any link to our WhatsApp                      | GA4; Meta Pixel as `Contact`                                                                            |
| `call_click`                    | the browser, any `tel:` link                               | GA4; Meta Pixel as `Contact`                                                                            |
| `generate_lead` (`lead_submit`) | the browser, /book's first step sent; the server, its lead | GA4 (a key event); Google Ads, imported from GA4; Meta Pixel and Conversions API as `Lead`              |
| `consult_booked`                | the server, a client's first consultation booked           | Meta Conversions API as `Schedule`; Google Ads (Data Manager)                                           |
| `consult_done`                  | the server, a client's first consultation done             | Meta Conversions API as `ConsultationDone` (physical store); Google Ads (Data Manager)                  |
| `first_fit_paid`                | the server, a first fit's payment captured                 | Meta Conversions API as `Purchase` (physical store), its value; Google Ads (Data Manager), its value    |
| `service_paid`                  | the server, any other payment captured                     | Meta Conversions API as `ServicePaid` (physical store), its value; Google Ads (Data Manager), its value |

Values are what was paid, before GST, in rupees. The server's events are recorded in `conversions` beside the write
that brings them about, and sent every five minutes by the cron; a platform that is down is tried again, and never
holds up a booking or Razorpay's webhook. A test record is never sent, nor a client erased or one who asked us to stop
(the client's page in the console, How they found us).

## Campaign tags

Every link we pay for or put out carries `utm_source`, `utm_medium` and `utm_campaign`, written in small letters with
hyphens between words. Google's own click IDs (`gclid`, `gbraid`, `wbraid`) come with Google Ads' auto-tagging, which
stays on.

| `utm_source` | `utm_medium`  | For                                                                                                                                                                  |
| ------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `google`     | `cpc`         | Google Ads: search, display, YouTube ads                                                                                                                             |
| `meta`       | `paid_social` | Meta ads, Facebook and Instagram. Every Meta ad's URL parameters carry these: Meta adds `fbclid` to unpaid posts too, so without them an ad counts as organic social |
| `youtube`    | `social`      | An unpaid YouTube post or description                                                                                                                                |
| `whatsapp`   | `social`      | A link shared in WhatsApp groups or status                                                                                                                           |
| `newsletter` | `email`       | An e-mail                                                                                                                                                            |
| `partner`    | `offline`     | A salon or partner's poster, where no partner code applies                                                                                                           |
| `society`    | `offline`     | A society activation: written by its link, never by hand                                                                                                             |

`utm_campaign` starts with its city, or with `national`: `gurgaon-search-hair-systems`, `national-brand-search`. Spend
is split by city by that first word ([ADR 0148](decisions/0148-the-channel-rule.md)).

## Channels

A touch's channel is the first of these that it carries: a friend's or a partner's code, a society's code, a Google
click ID, a click-to-WhatsApp ad, the campaign tags, Meta's click ID alone (organic social), the page before (a search
engine, a social site, another site), the channel a call was put under, a chat or a call with nothing else, and Direct.
A client's channel is their first touch's, unless a code reached us before their first consultation was booked. What
the client tells ops at the consultation is kept beside it, never in place of it.

## Making a society activation's link

1. In the console, Growth › Campaign links › New society activation.
2. Type the society's name, its pincode and the day, and each cost: the stall fee, staff hours and the rate an hour,
   collateral, and anything else with what it was. Each cost goes on the figures as spend on that day.
3. Pick a discount code if the society has an offer. It is taken off the first fit by itself, and only for an address
   in the society's pincode.
4. Make link. The link is `maneman.in/s/<slug>`; it opens /book with `utm_source=society`, `utm_medium=offline`,
   `utm_campaign=<slug>-<yyyymmdd>` and the society's code in `soc`.
5. Save the QR code as PNG for print, or SVG for a designer, and copy the link for WhatsApp. The society's code is on
   the same row, for anyone who types the link by hand.

An offer link (New offer link) is the same for an ad, a post or a newsletter, at `maneman.in/o/<slug>`, with the tags
picked from the lists above. Retiring a link sends it to /book with nothing, and keeps what it brought.

## Test mode

`CONVERSIONS_TEST_MODE` is `"true"` on staging, always: Meta's events go to the dataset's Test Events, under
`META_TEST_EVENT_CODE`, and Google's are `validateOnly`, so nothing counts. Each platform sends once its secrets are
set (`.dev.vars.example` lists them) and holds its conversions while none is; the steps are in
[go-live](go-live.md).
