# 0283. What ops configure is changed, and deleted while nothing uses it

- Status: accepted
- Date: 2026-11-19
- Topic: Console
- Amends [0108](0108-discount-codes.md), [0109](0109-console-departments-and-access.md), [0141](0141-quick-replies.md), [0169](0169-supplier-claims.md) and [0198](0198-cities-as-data.md) on what may be changed or deleted

## Context

The owner, 19 November: everything ops configure must be editable and deletable, deleted while nothing uses it, and
otherwise retired or switched off. Several things were not. A zone was added and never renamed or deleted. A quick
reply was added and retired, never changed. A discount code never changed once made, even one no booking had taken. A
city or a pincode added by mistake could only be hidden or left unserved. The five points a hair system is checked
against on arrival were fixed in the code, each only switched on or off, and the owner ruled that ops add, rename and
retire their own.

## Decision

1. **A zone** is renamed at Admin › Cities, and its cities, stock places, technicians and the staff grants over it move
   to the new name in the same batch. It is deleted while none of those names it.
2. **A quick reply** on the list has its title and words changed in its own form.
3. **A discount code's terms** change while no booking has taken it and no partner gives it out: what it takes off, on
   what, until when and how often. Its text stays as made. Once a booking has taken it, it is only switched off, as
   before.
4. **A city** is deleted while nothing but its own settings names it: no client, address, visit, pincode, technician,
   stock place, figure or staff grant. Its own prices, rules, closed days and pay rates go with it in the same batch.
   One in use is hidden instead, as before.
5. **A pincode** is deleted while we do not go there and no address, visit, hold, waitlist entry, consultation request,
   attribution or launch names it. A served one is stopped first.
6. **The checks on a hair system that arrives** are rows (`qc_points`, migration 0226) kept beneath Settings ›
   Purchasing. Each is added, renamed and switched on or off there, and deleted while no claim names it. The five the
   code held are its first rows, each on or off as the old setting had it, and that setting goes. A receipt names the
   points by their IDs. A claim keeps their names as they read when it was drafted, so a rename later leaves it as it
   was. Claims drafted before keep the five names, which the migration copies onto them.
7. Each change and delete is audited in its own batch, and only when it lands. A refused one writes nothing.

## Consequences

- Each list says whether a row may be deleted (`deletable`), and the console offers Delete only then. A delete that
  loses a race to a first use is refused as `in_use`, in the words of the screen it was asked from.
- A row in use is never deleted, so nothing that names one is ever left pointing at nothing.
- Renaming a zone or a check changes only the name read from then on. A claim already drafted keeps the names it read,
  and the audit keeps IDs.
