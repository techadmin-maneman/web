# Technician redesign: the report

What the technician app's redesign did, against the brief (`docs/prompts/tech-redesign.md`) and the plan
(`docs/technician-redesign/PLAN.md`), as of PR 11. The ADRs of each PR (0239 to 0250, and PR 11's) hold the reasons.

## The states, old to new

Every state the plan's section 3 maps, by the folder of the screenshots it was taken from, and the PR that drew it in
the new look. A state is done where its PR has merged.

| Old screen                        | New                                              | PR                  | Done      |
| --------------------------------- | ------------------------------------------------ | ------------------- | --------- |
| 01 Sign in                        | Sign in, with the language switch                | 11                  | on its PR |
| 02 Today                          | Today (tab)                                      | 3 (#862)            | done      |
| 03 Your week                      | Schedule (tab) and its preview                   | 9 (#870)            | done      |
| 04 Your month                     | Me: incentives                                   | 9 (#870)            | done      |
| 05 Your leave                     | Me → Leave                                       | 9 (#870)            | done      |
| 06 Kit                            | Kit (tab), Next 7 days, a request to ops         | 9 (#870)            | done      |
| 07 Job card and the door          | Job, At the door, Client history                 | 4 and 5 (#864)      | done      |
| 08 Options                        | the Options step                                 | 7 (#868)            | done      |
| 09 Before photos, 14 After photos | the photograph steps                             | 5 (#864)            | done      |
| 10 Checklist                      | guided tasks                                     | 6 (#865)            | done      |
| 11 Consumables                    | the Consumables step                             | 6 (#865)            | done      |
| 12 Piece                          | the Hair system step                             | 6 (#865), 7 (#868)  | done      |
| 13 Profile                        | Hair profile, Colour and style                   | 2 (#860), 6 (#865)  | done      |
| 15 Outcome                        | Outcome, and the Decision on a one visit         | 6 (#865), 7 (#868)  | done      |
| 16 Close-out                      | Closed                                           | 7 (#866)            | done      |
| 17 Waiting                        | Me → Pending uploads                             | 7 (#866)            | done      |
| 18 Errors                         | each screen's own states; the job-changed dialog | 7 (#866), 10 (#873) | done      |
| (new)                             | Safety: SOS and live location                    | 8 (#869)            | done      |
| (new)                             | Guides; Alerts with web push                     | 10 (#873)           | on its PR |
| (new)                             | Hindi on every screen                            | 11                  | on its PR |

**Sign in** is in no PR of the plan's eleven; the owner asked for it with PR 11, from the screenshots in `01-sign-in`.
It is drawn in the light look of the board's technician screens. Its fifteen states keep their words; the code sent shows
the number under the title, and "Change number" and the resend's count sit together under the boxes (ADR 0251).

## The backend gaps

Each gap of the plan's section 5, built in the PR named; none is mocked. The browser tests fake the API
(`e2e/tech/fake-tech.ts`), as they did before the redesign; the worker tests run each route on a real D1.

| Gap                                                            | PR         |
| -------------------------------------------------------------- | ---------- |
| 1. Client-level history, notes and alerts                      | 4          |
| 2. The next technician's note                                  | 4          |
| 3. Drive time and leave-by per job                             | 3          |
| 4. Alerts: time to leave, day ahead, job changes, running over | 10         |
| 5. Ops sending back a step, with a reason                      | 7          |
| 6. Job cancelled or moved, live                                | 7, 10      |
| 7. Kit forecast for 7 days, request to ops                     | 9          |
| 8. Label validation against the kit and the client             | existed; 7 |
| 9. Discount codes, payment link, status                        | existed    |
| 10. Reschedule with a reason                                   | 9          |
| 11. Quality, incentives                                        | 9          |
| 12. The profile at a first fit                                 | 2          |
| 13. Leave requests and status                                  | existed; 9 |
| 14. SOS and live location                                      | 8          |
| 15. Me: role, city, phone                                      | 9          |
| 16. A visit's elapsed bar and "Finish by"                      | existed    |
| 17. Gate code                                                  | 5          |
| 18. Head measurements in inches                                | 2          |
| 19. A consultation without consumables                         | 2          |

## Not matched to the prototype

- **Contact ops' hours** and **the reschedule sheet's fee note** wait for an ops setting to hold them (ADR 0249).
- **The client rating** on Me waits for ratings to exist (ADR 0249).
- **"Photos on Wi-Fi only"** is not offered: the phone sends what it holds as soon as it has signal (ADR 0247).
- **The bell's count** is square, the brand's edge; **Guides' list** says how many steps without a visit's length; **the
  lock screen** names no client (ADR 0250).
- **The lock screen's words** stay English in Hindi: the service worker is built apart from the app and keeps its own
  few words.
- **A guide's steps and a checklist's items** come from the console. Those the prototype's catalog words show in
  Hindi; one ops write or reword there shows as written until the catalog holds it.

## The lines still in English

None. The prototype's catalog (`design/tech-redesign/strings-hi.json`) words the lines it draws. The app's own lines,
the states and refusals the prototype does not draw and the words of the new parts, are worded in
`apps/tech/src/lang/app-hi.json`, as are the job sheet's committed lists and each guided task's words. Every line the
app can show from them is in Hindi when the app speaks it, for a name, a count of one, two or none, and nothing at all.
The Hindi of both files is a draft for a native speaker's review, the guide steps first (the brief asks for it).
`test/node/front-ends/tech-hindi.test.ts` holds this list to the app's lines, so a line added without Hindi is listed
here.

<!-- still-english:start -->
<!-- still-english:end -->
