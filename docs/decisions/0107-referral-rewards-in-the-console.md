# 0107. What a referral earns, set in the console, each side apart

- Status: accepted, on the owner's ruling of 1 October 2026 (ADR 0025, item 94). What the ruling left open is taken for the owner to confirm (item 94), and the words for unequal sides and for 0 await the owner's (`docs/open-points.md`, item 172).
- Date: 2026-10-01
- Amends [0048](0048-referrals.md), whose grant gave each side 3 service visits expiring in 365 days, and the prompt's rule as `src/policy/referral-reward.ts` quotes it, "the referrer and the referred each get 3 service-visit credits"; extends [0088](0088-every-policy-in-the-console.md) by one more input; follows [0073](0073-prices-from-the-price-book.md), whose way of writing a figure into the site this takes

## Context

What a referral earns was a figure in code: `CREDITS_PER_REFERRAL = 3` for both sides and `CREDIT_TTL_DAYS = 365` in `src/policy/referral-reward.ts`, a copy of the 3 in the client app, and about a dozen sentences across the landing, the app and the console typing "3 service visits". ADR 0061 had left the credits' life in code on purpose: "a term clients were promised, not a dial".

On 1 October 2026 the owner asked: "how are referrals configured? Is it a hard coded number? If so, make it editable in ops dashboard", and of the rewards, "for both the referree and the referred". Offered the choice, the owner chose **"Each side's visits + validity"**: ops set, in the console, the referrer's free service visits and the referred friend's free service visits separately, and how long the credits last. A rupee reward for either side was offered and not chosen.

## Decision

### One input, three figures

`referral_reward` joins Settings · Rules (`src/policy/ops-settings.ts`) as a rule of numbers with three keys:

| Key               | To begin with                                  | Bounds           | In the console                 |
| ----------------- | ---------------------------------------------- | ---------------- | ------------------------------ |
| `referrer_visits` | 3 (`CREDITS_PER_REFERRAL`)                     | 0 to 12 visits   | The client who sent the invite |
| `friend_visits`   | 3                                              | 0 to 12 visits   | The friend they invited        |
| `valid_days`      | 365 days (`CREDIT_TTL_DAYS`, ADR 0025 item 24) | 30 to 1,095 days | The credits last               |

- **The defaults are the committed figures**, so nothing changes until ops save. The figures stay in `src/policy/referral-reward.ts` beside the rule, as every input's do (ADR 0088), and its `RULES` keep the prompt's words and add the owner's.
- **Either side may be 0**, for none. Twelve visits is a year of monthly service visits, as many as ops may give or take by hand in one change; a month is the shortest life worth a credit, since a service visit falls due monthly, and three years is the longest replacement cycle ops may set (`piece_cycle_days`).
- **The console's usual check** shows each figure that moves, the old beside the new, before the second press sends it (ADR 0071); the rule's note says whom it reaches: every friend fitted after the change, while credits already given keep theirs.

### The reward in force when the friend is fitted

**The grant reads the reward when the friend's first fit settles the referral**, on the five-minute cron that settles it (`src/scheduled/referrals.ts`), not when the invite was sent or the consultation booked. This is the coordinator's default, for the owner to confirm (ADR 0025, item 94): a reward is earned by the fit, and an invite can wait a year on a waitlist (ADR 0048) through any number of changes. A consultation and fit in one visit settles the referral once its payment is in ([0105](0105-a-consultation-and-fit-in-one-visit.md); ADR 0025, item 93), and takes the reward in force then.

- **The referral keeps the reward it was settled under.** Migration 0062 adds `referrer_visits`, `friend_visits` and `credit_valid_days` to `referral_attributions`, written when the referral is granted or held. A grant held for review is given what was in force when it was held, whenever ops approve it, and a rejection is told to each side that reward would have given visits. A grant held before the migration kept none, and takes the reward in force when ops decide it. So does an invite ops attach after the friend's first fit, which is held for review as it is attached (the owner's ruling of 30 September 2026 on open point 157): it keeps no reward, and takes the one in force when ops approve it, the simplest rule consistent with the rest.
- **Credits already given keep their visits and their date.** The ledger holds each grant's visits and expiry (ADR 0033), and nothing a setting does reaches back into it.
- **The credits' life is the referral's alone.** Visits ops give by hand in the client's page, and the back-filled log of before January (`scripts/ops/import-referrals.ts`), keep 365 days.

### A side given nothing

- **No credits, and no word of visits it has not got.** A friend set to 0 gets no grant and no "credited" message; a referrer set to 0 gets no grant, and is still told their friend was fitted, and thanked, since ADR 0048's ruling 3 is that the referrer is told. Neither is told of a rejection of visits it would not have had, and the app tells a friend held under a reward that gives them nothing neither that their visits are being checked nor that they were refused (`invite_credits` is null).
- **The fraud holds still run.** A grant meeting one is held for ops whatever it gives, since the rules are also about who refers whom; one that gives nobody anything is rare enough not to need its own path.
- **The referrer's tracker** says beside each friend what the referrer was given for them, from the ledger, and nothing where it was 0; its total is their sum. It typed 3 beside every friend before.

### Every sentence reads the figures

- **The site.** `GET /api/referral-reward` (public host, cacheable for a minute) answers the three figures. mm-site's Worker reads it as it reads the prices (ADR 0073), kept a minute, on `/r/:code` and `/book`: it writes it onto `<body>` as `data-reward` for the landing's island, and builds the invite's preview description from it, which promises the friend's visits only where there are any. Where the Worker could not, the island asks for it itself. The landing's offer, its "who is told" line, its booked and expired confirmations and `/book`'s confirmation are built from the reward in `site/src/content/referral.ts`; where the reward is not known, no sentence gives a count.
- **The app.** `GET /api/me` answers `referral_reward`, so the Refer tab's promise, for a lead as for a fitted client, and the invite's preview read it, the preview held to the landing's by `test/node/apps/app/app-invite-preview.test.ts`. `GET /api/refer` gives each fitted friend's `visits`. The app's copy of the 3, `apps/app/src/lib/referral.ts`, is gone. The Refer pages read both through a view that lets them be missing (`apps/app/src/refer/reward.ts`), since the service worker serves the Home it kept, which may be from before this release, when the network is slow or absent, and an mm-api rolled back answers neither: the pages then give no count, as the site does.
- **The WhatsApp texts** take the counts as words ("1 service visit", "3 service visits"), so `friend_fitted_v1` and `friend_credited_v1` give way to `friend_fitted_v2` and `friend_credited_v2`. The referrer's text is one of four, by what each side was given: the same (`friend_fitted_v2`), different (`friend_fitted_each_v1`), nothing to the friend (`friend_fitted_yours_v1`), nothing to the referrer (`friend_fitted_thanks_v1`). Each is composed from the ledger when it is sent. The friend's now ends "Your balance is in the app.", where it said "They are in the app.", which one visit would not be.
- **The console** names no count either: the client's invite reads "What it earns", and a pending one "Given when this client is fitted".
- **The words for unequal sides and for 0** are ours, in the owner's voice (ADR 0103), until the owner words them (`docs/open-points.md`, item 172):

| Reward            | The landing's offer                                               |
| ----------------- | ----------------------------------------------------------------- |
| Both the same     | Get fitted and you both get 3 service visits free.                |
| Different         | Get fitted and you get 2 service visits free. Your friend gets 3. |
| The referrer only | Get fitted and your friend gets 3 service visits free.            |
| The friend only   | Get fitted and you get 3 service visits free.                     |
| Nothing           | No offer line; the consultation is still free.                    |

- **The app's promise** says the same from the referrer's side: "When a friend you refer is fitted, you both get 3 service visits free.", "… you get 3 service visits free, and your friend gets 2.", "… you get 3 service visits free.", "… they get 3 service visits free.", and, where nobody gets anything, "… we tell you."
- **The site's production gate** now also stops a build in which the landing's or the site's words type a count of visits ("3 service visits"), as it stops a typed price, and a reward spelled out in words ("three service visits free", "the three visits land"). A count in words that is no reward passes: the site's "twelve service visits" for a year of them, and "in one visit" for the fit.

### Found on the way: a rule's second change

Ops could change each rule once. `setOpsSetting` wrote `ops_settings` with an upsert, and SQLite runs a trigger's statements under the conflict policy of the statement that fired it, so the snapshot trigger's own `INSERT OR REPLACE` (migration 0054) ran as a plain insert and refused the row already there: the console answered 500 to the second save of any rule, and nothing changed. The write is now `INSERT OR REPLACE`, under which the trigger's own `OR REPLACE` stands and rewrites the snapshot; `test/worker/ops/ops-settings.test.ts` changes a rule twice.

## Consequences

- **The contract** gains `GET /api/referral-reward` on the public host, `referral_reward` on `GET /api/me` and `visits` on each of `GET /api/refer`'s fitted friends; `docs/openapi*.json`, `docs/api*.md` and the apps' schemas are regenerated.
- **Migration 0062** adds three nullable columns; the Worker already deployed reads none of them.
- **The register holds one more input**, and the snapshot stays far under `MAX_SNAPSHOT_BYTES`.
- **mm-site asks mm-api for the reward** about once a minute per isolate on `/r/:code` and `/book`, beside the prices (ADR 0073); a failed read keeps the last good one, and failing that the pages promise no count.
- **Owed by the owner:** whether the reward should be the one in force when the friend is fitted (ADR 0025, item 94), and the words for unequal sides and for 0 (item 172).

**Confirmed by the owner, 1 October 2026:** the reward that applies is the one in force when the friend is fitted.
