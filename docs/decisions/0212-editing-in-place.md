# 0212. Editing in place

- Status: accepted
- Date: 2026-10-18
- Topic: The ops console
- Supersedes [0071](0071-what-ops-see-before-a-setting-changes.md) for changing a setting or a record; its check stays for a few acts that record an event, below

## Context

Editing worked differently from page to page in the console: six patterns across about forty screens. In Services, ops pressed Edit, then picked an action, then changed the value. On the rule pages every box was open at once, behind one Save at the foot, so a change elsewhere on the page was easy to lose. Most other settings went through a form with a review step before anything was sent. On 18 October 2026 the owner asked for one world-class way, everywhere, and approved the plan (https://claude.ai/artifact/FB1iYqD51fxTq9KvHQoiHp): Enter or Save saves, never a click away, and records keep their side panel or page.

## Decision

1. **Every value reads as words, and changes where it reads** (`@maneman/ui/EditableRow`; the console's rows in `components/RecordRows.tsx`). A click on it, or Enter, opens its box in place, already focused. Enter or Save keeps the change; Escape or Cancel puts it back; focus returns to the value.
2. **One value saves at a time.** "Saved" shows beside it. A refusal shows under the box in its own words, the box still open. There is no page-wide Save, so nothing elsewhere on the page is lost. Where the API takes a record whole, the row sends the rest as they stand.
3. **A price or a rate asks its day in the same row**, tomorrow or today to begin with, so none starts unseen. A price opens on the one in force, its GST included. One still to come is withdrawn from beside it.
4. **Something new is added from a short form** (`components/AddForm.tsx`): its few boxes and Add, sent by Enter or Add with no second step. A refusal is said on the box it names. Where what is added has a consequence, it reads beneath the boxes as they are typed: the codes a batch makes, the visits closing days strands, a window's new hours, a payment short of what is due.
5. **Retiring, closing and deleting sit at a record's foot.** Each says what happens and asks once, in place (`components/DeleteAction.tsx`). Putting something back is one press.
6. **A person who may only look** sees each value as it reads, with nothing to press (the owner's ruling of 15 October 2026).
7. **Tables are for finding and comparing**: no boxes and no actions in them. A row's name opens its record in a side panel; a list's items, as the job sheet's, carry their own move and take-off buttons, each change sent at once and undone by another.

## Consequences

- Every Settings and Admin screen uses it: rules, consultation and fees, packages, a client's package, consumables and each service's expected use, suppliers and what they supply, partners, cities and their own rules, city prices, GST registrations, discount codes, staff and service tokens, pay grades and each technician's grade, words, the job sheet, closed days, window times, the Care team and quick replies, targets, stock places, the letterhead, and a technician's details and week.
- A few acts record an event rather than change a value, and keep their own form: booking, moving and cancelling a visit, a stock movement, receiving an order, a refund, a technician's leave, a spend entry, a partner's payment, publishing the words. Those that move stock or money, or publish, keep the check before they are sent. A hair profile is corrected whole, each correction a new version; the service area's pincodes change from a file, with one Save that says first whom it will message.
- `settings/SettingForm.tsx`, its steps and its action check are gone. `test/node/apps/ops/ops-settings-writes.test.ts` holds Settings to a row's save, an AddForm, a DeleteAction or a list's own buttons.
- Tests: `test/dom/ui-editable-row.test.ts`, and each screen's own.
