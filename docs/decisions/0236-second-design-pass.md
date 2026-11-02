# 0236. The second design pass: heads, folded lists, items, and each thing where it is used

- Status: accepted
- Date: 2026-11-02
- Topic: The ops console
- Amends [0225](0225-the-console-on-a-desk-and-a-phone.md): a table's heads sort on a desk, a Sort by list on a phone

## Context

On 2 November 2026 the owner looked through the console again and found it still short of consistent: table heads
that read as a stray line; padding that kept going wrong; units on a second line and a "Low at" column on Items that
nobody asked for there; the switched-off technicians shown in full and tied to the live list; "Reach from home: The
business's", which said nothing; a technician's kit sent to Stock to record a movement, under another name and look;
and a client's visit with its state, its buttons and its reason all in one cell.

## Decision

1. **A table's heads are a band of the page's ground**, as the design draws them: centred in the band, a hairline
   beneath, the names in the muted ink.
2. **What is switched off, retired or paused is a panel of its own** beneath the live list, folded, its head saying
   how many (`Apart`): technicians, staff, suppliers, consumables and hair systems.
3. **Padding has one cause and one fix.** A panel has no room at its sides of its own; each part inside brings its
   inset. The form's fields did not, so a form dropped straight into a panel touched its edge. Fields straight inside a
   panel now take the panel's inset (`forms.module.css`), and every page was measured for anything touching a panel's
   edge, at 1440 and 390: none does.
4. **Items lists what an item is:** its name, its unit in a column of its own, and its cost; each sorts, and the list
   is searched and narrowed by unit. The levels it is low at stay on its record and on Stock, where they are acted on.
5. **A technician's reach reads as what it is:** "Takes visits within 45 min drive of home, the setting for everyone",
   the roster now carrying everyone's reach (`default_reach_min`).
6. **A kit's movement is recorded on the technician's Kit tab**, by the same "Record a movement" Stock has, in the
   same drawer, starting at their kit.
7. **A client's visit keeps its state in Status and its buttons in a column of their own** at the row's end.
8. **Stock's Labels chooses its item and place in its head**, as every panel's picker is.

## Consequences

- Sorting and searching every list, and list rows on a phone, follow as the next phase.
- Words added, in `design/ops-redesign/COPY-TODO.md`.
