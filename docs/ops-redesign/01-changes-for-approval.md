# Ops console redesign: functionality changes for approval

Status: decided by Adwate on 22 Nov 2026. Nothing in section B may be dropped. Decisions:

- **A1–A9 and A11: approved as written.** A9's look-ahead is 4 weeks.
- **A10: approved in part.** Drop the "Two letters: HR for Haryana" hint, since a state picker replaces it. Keep the
  line warning what renaming a city changes.
- **A12: no change versus today**, so there is nothing to approve.
- **Section C: build all of it.**
- The decisions on what the prototype changes beyond this list (D1 to D6) are in `parity.md`.

How this list was made:

- The 1,271 screenshots of the current console (`ops-console-screens-2026-11-22`) were OCR'd.
- Each captured action (every button, filter, tab, drawer and form) was matched against the prototype's text, including every form, panel and settings edit.
- Behaviour that a screenshot can't show (server rules, background jobs, notifications, permissions logic) was not audited. The agent must check those in code (prompt, step 2).

## A. Deliberate changes that remove or alter something (approve or reject each)

| #   | Area                 | Current console                                                 | Redesign                                                                                                                                                                                                                                          | Why                                                                                            |
| --- | -------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| A1  | Settings navigation  | Separate settings menu column with every page listed            | Sidebar sub-menu lists the 9 groups. Each group's pages are tabs at the top, same as Inventory. "Find a setting" sits beside the tabs and still matches individual settings by name.                                                              | You asked for it to match Inventory                                                            |
| A2  | Editing a setting    | The whole value is edited as free text (e.g. "45 minutes")      | Only the number is editable. Units and helper text are fixed, times use a time picker, Yes/No and Allowed/Not allowed use a choice, and lists use checkboxes. Free text stays only where the value is text (descriptions, names).                 | You asked for it. Risk: any setting stored as free text needs a typed field before this works. |
| A3  | Forms with units     | e.g. "Payment terms: 30 days" typed as text                     | Number field with the unit beside it                                                                                                                                                                                                              | Same rule as A2                                                                                |
| A4  | Popups               | Mix of centred popups, dropdowns and drawers                    | One right-hand panel (bottom sheet on phone) for every record, form, edit and confirmation. Only the search palette stays centred. Dropdown menus remain only for the city picker and the account menu.                                           | You asked for one standard pattern                                                             |
| A5  | Messages             | "Open client" button on the right                               | Client name in the chat header is a link                                                                                                                                                                                                          | You asked for it                                                                               |
| A6  | Clients              | "Lead from a call" button                                       | Renamed "Add a client". Same fields (name, number, where they came from) plus pincode.                                                                                                                                                            | Clearer label; confirm the rename                                                              |
| A7  | Messages filter      | "My clients"                                                    | Renamed "Mine"                                                                                                                                                                                                                                    | Shorter; confirm                                                                               |
| A8  | Stock, On hand       | One table, warehouse plus every technician's kit side by side   | Opens on the warehouse only. A "Whose stock" picker switches to one kit. "Every place, side by side" is still available in the picker.                                                                                                            | You asked for it                                                                               |
| A9  | Kit warning          | "Kit below zero" (negative count)                               | "Kit short": the kit holds less than the technician's booked visits need over the next 4 weeks. Below-zero still counts as short.                                                                                                                 | Earlier warning. Needs booked-visit usage per kit; confirm the definition                      |
| A10 | City form            | Two helper lines (rename effect; "Two letters: HR for Haryana") | Removed                                                                                                                                                                                                                                           | You asked for it                                                                               |
| A11 | Delete rules (new)   | Not consistent across records                                   | Retire when anything is linked, delete only when nothing ever was. This applies to: packages, hair systems (retire only), discount codes, cities, pincodes. City and pincode delete is blocked while clients, technicians or pincodes are linked. | Keeps history intact; confirm the rules                                                        |
| A12 | Technician Hours tab | Did not have "Most visits a day"                                | Not added. The first prototype had added it; now removed.                                                                                                                                                                                         | No change versus today                                                                         |

## B. Present today, not drawn in the prototype: must be kept, restyled to the new system

1. **Dispatch move mode:** "A technician and day" / "Stop moving" (drag a visit to another technician or day).
2. **Requests detail flows:** concerns, number changes and deletion requests, each with its full detail and action steps.
3. **Money detail flows:**
   - Payments: row detail, Refund, Record UPI, the "In the books" status and filter, the date range.
   - Charges, Technician pay (month picker June to November), Partner commission.
4. **Words:** per-entry details for every page (Areas, Book, Contact, Every page, Guides, header items), "Publish the site", "Show more".
5. **Pagination:** Tasks ("Show N more" / "Show fewer"), Payments ("Show more"), Activity ("Show older").
6. **Activity filters:** Who (client, service token, staff, system, technician) and What (client app request, consent changed, console request, refused, technician app request).
7. **Stock labels:** "Scan with camera" / "Stop camera".
8. **Items:**
   - Unit (piece, sachet, strip, ml).
   - Which services and packages use the item, and how much.
   - Change thresholds.
9. **Suppliers:** country and currency.
10. **Usage:** "Items of <technician>" filter.
11. **Supply plan:** city filter (Delhi, Faridabad, Ghaziabad, Mumbai, Noida).
12. **Targets:** city and month pickers going back to Nov 2025.
13. **Closed days:** per-city choice and Reopen.
14. **Job sheet:** reorder and change items for every visit type.
15. **Pay grades:** open a grade, open a technician, "No grade, so not paid".
16. **Care team:** "Today: off shift".
17. **Client page actions on every tab:**
    - Visits: discount code per booked visit, "See on the board", Change.
    - Hair systems: Change current package.
    - Referrals: How they heard of us.
    - Messages: Close chat with "What it was about".
    - Referrals: "Attach an invite", "Stop sharing <client>’s details with …" (label as in the current console).
    - Consents: Erase.
    - Photos: View photos.
18. **Tasks:** Assign to a named person, plus every task kind (address to confirm, at-risk client, call about a move, city matter, concern, replacement order, visit with no address).
19. **Roles:** every role and view-only rule exactly as today (care, city head, dispatcher, finance, growth, no-money-access, view-only).

## C. New in the redesign (no loss; listed so you can veto)

1. **Dispatch:**
   - "Consultation and first fit" as a visit type, filter and colour.
   - Visit-type filter chips on the day and week views.
2. **Clients:** "Recently opened" strip above the table.
3. **Linked client names:** client names are links everywhere (visit panel, messages, discount code uses, activity).
4. **Hair profile:**
   - Full version history: every edit saves a new version, with "was X" differences shown.
   - All fields: head measurements, base, hair, product, health history (remedies tried, transplant year, skin conditions, allergies).
5. **Technician:** start date on Add and Edit, and "Started …" in the header.
6. **Areas:** "Add pincodes" as the page action, with three ways to add (one pincode, a whole district, CSV). Pincode panel with Delete.
7. **Cities:** a panel per city, with each field editable on its own and Delete. Previously every city opened the same form.
8. **Packages:**
   - A state column (Selling, Not on sale, Retired) with filters.
   - Retire or Delete package; retire a hair system; put a retired package back on sale.
9. **Discount codes:**
   - A panel per code: edit, list of uses, Retire or Delete, download uses.
   - An "Every use" view across all codes.
10. **Stock:** "Next 4 weeks" shortfalls name who needs what (e.g. "Send 17 strips to Sandeep").
11. **Layout:** text and its button sit on one line in every row (alignment fix).
12. **Flicker:** fixed at the render layer (see the prompt).
