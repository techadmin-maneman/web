# 0219. One-line consents, with the full notice a link away

- Status: accepted
- Date: 2026-10-19
- Topic: Privacy and accounts
- Amends [0049](0049-dpdp.md), [0104](0104-the-try-ons-look-on-whatsapp-only.md) and [0217](0217-the-try-ons-photo-taken-and-looked-at.md)

## Context

On 19 October 2026 the owner asked that every consent on the site and in the app be one line, with a link to the full
notice, as terms and conditions are, and that the try-on's "What happens to your photograph" screen go: five rows and
a box to tick before the visitor could choose a look.

## Decision

1. **The full notices live on the site's /notices page,** a section each: the try-on, your photos, and WhatsApp
   (`NOTICE_SECTIONS`, src/config/notice-sections.ts). Each consent shows one line; `@maneman/ui/NoticeLine` links
   the words in it that name the notice, or adds "Details" after it, and opens the section in a new tab.
2. **The try-on's consent screen goes.** The photo's line sits on the photo review, above Retake and Use photo:
   using the photo is the agreement. The gate's line sits beneath Send my look. Both are new versions, photo-v7 and
   gate-v7, which record the line with the try-on section's words; photo-v7 still keeps a client's try-on (ADR 0084).
3. **The referral card's five lines become one,** photos-referral-cards-v3, which records the photos section's words
   with it. The section says the referrer's first name appears on their invite, so an invite still names them
   (`NAMING_NOTICES` reads a section's row as well as a line).
4. **A line whose words stay keeps its version** and gains its link: the booking confirmation (site-consultation-v2,
   referral-consultation-v2), the waitlist's two (waitlist-v1, whatsapp-launches-v1, which counsel approved) and the
   app's reminder box (whatsapp-visits-booking-v2). The pay step's line on visit photos, which agrees to nothing, links
   to the photos section.
5. **A consent's line is off the Words page:** its words are its notice's.

## Consequences

- The new versions await counsel with the rest, so production's build still refuses them until approved.
- A client who agreed to cards under an earlier notice is asked again under v3, as any changed notice asks.
