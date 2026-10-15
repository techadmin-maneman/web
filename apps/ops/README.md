# The ops console

Ops' desk tool, behind Cloudflare Access (docs/decisions/0031-access-and-audit.md). Each page is a folder of `src/`,
named as its path is; the calls several pages share, the client itself, and the types the answers are named by are
`src/api.ts`.

| Entry       | Pages, as its tabs                                                                | Folders                                                                                                                                                                                    |
| ----------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Today       | `/today`, where the console opens                                                 | `today/`                                                                                                                                                                                   |
| Tasks       | `/tasks`                                                                          | `tasks/`                                                                                                                                                                                   |
| Dispatch    | `/dispatch`                                                                       | `dispatch/`                                                                                                                                                                                |
| Clients     | `/clients`, `/clients/:id/:tab`                                                   | `clients/`                                                                                                                                                                                 |
| Messages    | `/messages`                                                                       | `care/`                                                                                                                                                                                    |
| Technicians | `/technicians`, `/technicians/:id/:tab`                                           | `technicians/`                                                                                                                                                                             |
| Inventory   | Stock, Counts, Purchasing, Supply plan, Quality, Usage, Items, Suppliers          | `stock/`, `counts/`, `purchasing/`, `supply-plan/`, `quality/`, `usage/`, `items/`, `suppliers/`                                                                                           |
| Requests    | Concerns (`/grievances`), Number changes, Deletion requests                       | `grievances/`, `number-changes/`, `deletion-requests/`                                                                                                                                     |
| Money       | Charges (`/payments`), Technician pay, Partner commission                         | `payments/`, `technician-pay/`, `partner-commission/`                                                                                                                                      |
| Growth      | Referrals, Waitlist, Spend                                                        | `referrals/`, `areas/`, `spend/`                                                                                                                                                           |
| Reports     | Care numbers, Activity                                                            | `care/`, `activity/`                                                                                                                                                                       |
| Settings    | `/settings/:page`, a page each under its group (`src/route.ts`, `SETTINGS_PAGES`) | `SettingsHub.tsx` draws each from its own folder: `cities/`, `areas/`, `targets/`, `settings/`, `prices/`, `discount-codes/`, `referrals/`, `words/`, `care/`, `staff/`, `technician-pay/` |

Each folder makes its calls through its own module, `<folder>-api.ts`. The navigation's entries, Settings' pages and
every old address that moved are `src/route.ts`'s; the frame is `components/Shell.tsx`, a row's form or a list's way
to add opens in `components/FormDrawer.tsx` or `components/DrawerButton.tsx`, and the dark theme is
`styles/theme.css` (docs/decisions/0208-the-console-redesigned.md).

What every section shares sits beside them: `components/` (the frame, `Refusal`, `RowHead`, `FormActions` and the
shared form sheet), `lib/` (access, the page read again, a write's shape), `states/`, `styles/` (the console's tokens)
and `content/` (every word, one file a feature). A section reads another's code only through that folder's
`index.ts`, which says what it offers (test/node/architecture/feature-imports.test.ts). `kit/` is the local-only page
of every shared part, as the console draws it.
