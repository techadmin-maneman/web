# 0212. Editing in place

- Status: accepted
- Date: 2026-10-18
- Topic: The ops console
- Supersedes [0071](0071-what-ops-see-before-a-setting-changes.md) for a value changed on its own row

## Context

Editing worked differently from page to page in the console: six patterns across about forty screens. In Services, ops pressed Edit, then picked an action, then changed the value. On the rule pages every box was open at once, behind one Save at the foot, so a change elsewhere on the page was easy to lose. On 18 October 2026 the owner asked for one world-class way, everywhere, and approved the plan (https://claude.ai/artifact/FB1iYqD51fxTq9KvHQoiHp): Enter or Save saves, never a click away, and records keep their side panel or page.

## Decision

1. **Every value reads as words, and changes where it reads** (`@maneman/ui/EditableRow`). A click on it, or Enter, opens its box in place, already focused. Enter or Save keeps the change; Escape or Cancel puts it back; focus returns to the value.
2. **One value saves at a time.** "Saved" shows beside it. A refusal shows under the box in its own words, the box still open. There is no page-wide Save, so nothing elsewhere on the page is lost.
3. **A price asks its day in the same row**, tomorrow to begin with, so none starts today by accident. It opens on the price in force, its GST included, so a rate never changes unseen. A price still to come is withdrawn from beside it.
4. **Retiring and deleting sit at a record's foot.** Each says what happens and asks once, in place.
5. **A person who may only look** sees each value as it reads, with nothing to press (the owner's ruling of 15 October 2026).
6. **Tables are for finding and comparing**: no boxes in them. A row opens its record.

## Consequences

- The rule pages, Consultation and fees, Packages and a client's package use it. Other screens move to it as each is next changed.
- The review step before a setting is sent goes for a value changed on its own row. What it guarded against is kept: the value as it stood shows until the change is kept, and a price never takes today's date or a new rate unseen.
- Tests: `test/dom/ui-editable-row.test.ts`.
