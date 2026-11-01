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
every old address that moved are `src/route.ts`'s; the frame is `frame/Shell.tsx`, a row's form or a list's way
to add opens in `@maneman/ui/FormDrawer` or `@maneman/ui/DrawerButton`, and the dark theme is
`styles/theme.css` (docs/decisions/0208-the-console-redesigned.md).

What every section shares sits beside them: `frame/` (the shell, the navigation, the account, Mine, search, the page
head and the page that did not draw), `lib/` (access, a write's shape), `styles/` (the console's tokens) and
`content/` (every word, one file a feature). Every shared part, `Refusal`, `RowHead`, `FormActions`, the drawers,
the confirm steps, the states and the shared form sheet among them, is the one library's, `packages/ui`. A section reads another's code only through that folder's
`index.ts`, which says what it offers (test/node/architecture/feature-imports.test.ts). `kit/` is the local-only page
of every shared part, as the console draws it.
