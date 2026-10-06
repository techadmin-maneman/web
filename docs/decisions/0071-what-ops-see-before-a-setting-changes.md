# 0071. What ops see before a setting changes, and who the console says they are

- Status: accepted
- Date: 2026-09-26
- Topic: The ops console
- Amends [0061](0061-ops-editable-inputs.md) for the price form, the service-area file and serving a pincode, and [0048](0048-referrals.md) for an area's name; follows [0031](0031-access-and-audit.md)

## Context

ADR 0061 gave ops the console's Settings section. The audit of 24 September 2026 used it the way ops would and found each panel able to change something without ops seeing what they were changing, and the console's frame unable to say who was working or that their session had run out:

| Finding        | What happened                                                                                                                                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OPS-15         | The price form opened with GST at 0 and no amount, whatever the item: an 18% item edited for its amount was saved GST-free. Nothing showed the old price beside the new; the tier was free text; a price set for next month could not be taken back. |
| FEO-01         | After a file was uploaded, the table still showed the old values, and the next Save put them back.                                                                                                                                                   |
| FEO-03         | A file without its `served` or `launch_on` column read every pincode in it as not served, or with no launch date: "The file changes 5 pincodes".                                                                                                     |
| FEO-02         | Serving a pincode from Settings set it served and told nobody on its waitlist. Only the waitlist's own launch sends the alerts, and the waitlist then showed the pincode as Live, with no way left to tell anyone.                                   |
| OPS-13         | Launch messages named areas by their post office: "we now come to Sec91", "RAKNPA". ADR 0048 kept that name "until ops give better ones", and gave them no way to.                                                                                   |
| SEC-03         | The list ops download quoted commas only: a cell opening with `=`, `+`, `-` or `@` would run as a formula in the spreadsheet it is edited in.                                                                                                        |
| FEO-06         | The API names the box it refused (`fields`); the console dropped it, so every refusal read the same.                                                                                                                                                 |
| OPS-20, FEO-12 | Every page was titled "Mane Man operations"; nothing said who was signed in or offered a way out; and a spent Access session read "You are offline".                                                                                                 |

## Decision

### A price is shown old beside new before it is set

- **The form starts from the price in force** for the item and tier chosen: its amount and its GST. A tier the book has never priced starts with no amount and the GST the item has in another tier, since GST follows what is sold. Above the boxes: "Now Rs. 2,000 + 18% GST, since 22 Sep 2026."
- **Set this price shows the change before sending it**: "Service visit, standard: Rs. 2,000 + 18% GST → Rs. 2,500 + 0% GST, from 1 Nov 2027", a line of its own in oxblood when GST changes, and a line when a price is already set from that day and would be replaced. Only the second press sends it.
- **The tier is a choice of the tiers the book holds**, with "A new tier" last, which asks for its name. ADR 0061's "a price for a new tier creates it" stands; a tier cannot be mistyped into a second one.
- **A price still to come can be taken back.** `POST /api/prices/withdraw` removes a row that applies after today, with a `price.withdraw` audit entry holding what it would have been, in one batch. The row in force and every spent one are refused (`400 invalid_request`, `fields: ["valid_from"]`): an invoice may stand on them. A hold keeps the figure it was quoted in any case (ADR 0068).
- **A refusal names its box**: the API's `fields` reach the form, so "First fit is outside what this rule allows" rather than one line for every refusal.

### The service area goes through its table, and serving is a launch

- **A file's changes go into the table.** The console reads the file, shows each pincode it would change with what the table shows now and what the file says, and "Put these in the table" puts them there. The one Save sends them, as it sends a change typed into a row, so the table and what is saved never part.
- **The file must carry all three of its columns**: `pincode`, `served` and `launch_on`. A file without one is refused whole. `served` reads yes, y, true and 1 as served, and no, n, false, 0 and a blank as not; any other word is refused with its pincode, rather than guessed at. The list ops download writes yes or no.
- **Serving a pincode is a launch, from whichever screen.** When `POST /api/service-area` begins serving a pincode, the same batch queues a launch alert for each person on its waitlist who asked to be told and still consents, marks them told, and writes a `pincode.launch` entry counting them, as the waitlist's launch does (`src/domain/booking/waitlist.ts` holds the rule once). The answer says how many (`alerted`), and the alerts leave ten a minute across every pincode the save launched. `GET /api/service-area` gives each pincode's `waiting` and `to_alert`, so a save that would message anyone first says how many, pincode by pincode, and its button reads "Save and message 3". Nobody is told twice, however often a pincode is switched off and on.
- **A pincode already live can still be told.** One served before this, from Settings or by the import, left its waitlist untold. Its row on the waitlist now opens the same panel, headed "Tell those waiting in 122018"; the launch route tells whoever is left, and says so when nobody is.
- **The import does not launch.** `scripts/ops/import-pincodes.ts` loads the reference file and tells nobody; the runbook says to serve a pincode people wait for from the console. **Amended 27 September 2026:** the import now refuses, writing nothing, while the file would serve a pincode that is not served yet and has people waiting, and names each one, so the runbook's rule no longer rests on the operator remembering it.

### An area has the name ops give it

- **Migration 0043** adds `serviceable_pincodes.area_named_by`: who named the area, or null while the name is still the post offices'. `area` itself carries the name, so the launch message, the waitlist, the booking pages and the dispatch board all read the better one with no change of their own.
- **Ops rename an area in its row** of Settings · Service area; the waitlist's launch panel says where the message's name comes from and links there. A name starts with a letter or a digit and runs to 40 characters of letters, digits, spaces and `. , ' ( ) & -`, so it can never open as a formula in the downloaded list. A rename is its own `pincode.rename` audit entry, from and to.
- **The import keeps a name ops gave.** Its upsert refreshes `area` only where `area_named_by` is null.
- **Every cell of the download is guarded**: a cell that opens with `=`, `+`, `-`, `@`, a tab or a carriage return starts with an apostrophe, and a cell holding a comma, a quote or a line break is quoted with its quotes doubled.

### The frame says who is working, and when Access has let go

- **`GET /api/whoami`** answers the Access identity behind the call and where signing out goes: Access's own `/cdn-cgi/access/logout`, or null where no Access stands in front, as on a laptop. The header shows board A1's box of initials with "Signed in as" and the e-mail beside it, and "Sign out". It is asked once per load of the console.
- **A spent session is named as one.** The console's calls no longer follow redirects. Access answers a call whose session has run out by sending it to the team's login page on another origin; the call sees an opaque redirect, or mm-api's own `access_required`, and the frame says once, over whichever section is open, that the sign-in has run out, with Reload, which is what takes ops to Access's login. It no longer says "You are offline".
- **Each page is titled by what it is**, "Prices · Settings · Mane Man operations", from the one table of sections in `apps/ops/src/route.ts`, which the navigation and the router read too. A client's page is titled by its tab, never by the client's name, which would then sit in the browser's history.
- **A click that asks for a new tab or window** (Ctrl, Cmd, Shift, Alt, or a middle click) is left to the browser.

## Consequences

- **The contract** gains `GET /api/whoami`, `POST /api/prices/withdraw`, `waiting` and `to_alert` on each pincode of `GET /api/service-area`, an optional `area` on each change and `alerted` in the answer of `POST /api/service-area`. `docs/openapi-ops.json` and `docs/api-ops.md` are regenerated. Two audit actions are added, `price.withdraw` and `pincode.rename`; no migration is needed for them.
- **Migration 0043** only adds a column, so the Worker already deployed is unaffected. `scripts/ops/import-pincodes.ts` needs it: run migrations before the import, as the runbook already says.
- **A save that serves many pincodes writes many statements in one batch**, two for each person told, as the waitlist's launch always has. Serving a whole city with a long waitlist is the largest such batch.
- **What is still owed the owner**: every word of Settings, the header's identity and the lapsed-session line is a placeholder in `apps/ops/src/content.ts`, as the rest of the console's copy is (`docs/open-points.md`, item 42); the departures from board A1's header are recorded in ADR 0025, item 49.
