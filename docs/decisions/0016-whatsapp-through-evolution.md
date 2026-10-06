# 0016. WhatsApp through Evolution API, for now

- Status: accepted
- Date: 2026-09-21
- Topic: Messages and the CRM

## Context

The prompt names three official WhatsApp Business Solution Providers (AiSensy, Interakt, Wati), to be chosen at the roadmap's 4 October gate. M3's proof needs a real message on a test handset before then.

A comparison of the three providers' documented APIs, read 21 September 2026, found:

- **Interakt** fits best. One call per message carries the image URL. It returns a message ID and sends signed delivery webhooks. Growth costs ₹2,799 a month.
- **AiSensy** needs an "API campaign" set up per template in its dashboard, and documents no message ID.
- **Wati's** trial cannot submit templates for approval.

None offers a sandbox with pre-approved templates, so Meta's approval of an image template gates any real test.

The owner chose, on 21 September 2026, to use **Evolution API** for now. The same integration already runs in the owner's poker-settle project.

## Decision

- `MESSAGING_PROVIDER` is `evolution` or `stub`. `src/providers/messaging/evolution.ts` sends through an Evolution API bridge: `POST {EVOLUTION_API_URL}/message/sendMedia/{EVOLUTION_INSTANCE_NAME}`, header `apikey`. The image is given as a URL, which the bridge downloads. Secrets: `EVOLUTION_API_URL` (https), `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME`. They replace the prompt's `BSP_API_KEY` and `BSP_BASE_URL`.
- Evolution has no Meta templates. A "template" is a text in `src/config/message-templates.ts`, chosen by `RESULT_TEMPLATE` in the same file (a Worker var, `WA_RESULT_TEMPLATE`, until 26 September 2026: see ADR 0009, rule 6). `tryon_result_v1` is placeholder copy for the owner to approve. Its second sentence is the design's own.
- Nothing outside the adapter knows the provider. Moving to an official BSP means one new adapter and new secrets; the messaging consumer, the table and the tests stay.
- Staging sends only to the numbers in `MESSAGING_ALLOWLIST`. It is a secret, so the founders' numbers are not in git, and staging refuses to start with messaging on and the list empty.
- Production keeps `MESSAGING_ENABLED = "false"`. The gate then promises no WhatsApp copy and every result message is skipped.

## Update, 21 September 2026: timeouts

On staging, the first two sends of the first result timed out at 20 seconds and were retried. Before each timeout the bridge had already fetched the image, so it was probably sending while we gave up; the third attempt succeeded. The bridge answers a media send only after uploading the image to WhatsApp.

- **More time.** The bridge now has 60 seconds to answer.
- **No retry after a timeout.** A timeout is never retried: the message may already be on the phone. It fails with "delivery unconfirmed" and an alert.
- **Still retried:** a failure to connect, a 429 and a 5xx.

## Consequences

- **Evolution is not an official provider.** It drives a WhatsApp account the way WhatsApp Web does. The sending number can be banned for automated sending, and there is no Meta template approval, delivery webhook or opt-out handling.
- **Fine for staging, not for production.** Production messaging stays off until an official provider is chosen; this research recommends Interakt.
- **The bridge must be reachable from Cloudflare** over public HTTPS. poker-settle's notes record that its bridge sits behind Tailscale and needs Funnel to be public.
- **The bridge must be able to fetch the image.** On staging, `/api/result/*` bypasses Cloudflare Access (runbook).
- **Use a separate number.** Mane Man should have its own Evolution instance and WhatsApp number, not share poker-settle's, so a ban on one does not take down the other.
