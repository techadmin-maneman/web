# 0310. The Growth and Reports screens, to the 22 November redesign

- Status: accepted
- Date: 2026-11-24
- Topic: The ops console

## Context

The redesign's sixth piece is Growth and Reports (docs/prompts/ops-redesign.md, step 6): the prototype draws the
Funnel with its figures beside the steps, Referrals, the Waitlist, Spend, Campaign links, Care numbers and Activity,
each with a line beside its title. What the console already does there stays (section B of the changes for approval):
Activity's Who and What filters (B6) and its older pages (B5), the Funnel's cohorts, dashboards and what clients said,
Referrals' partners, and the Waitlist's pincodes to open next. Driving, under Reports, is ours and not drawn.

## Decision

1. **Each page says its count beside its title**, left out at none: the Waitlist how many wait ("27 waiting", "27+"
   where the list holds only the first), Campaign links how many are live, Referrals how many rewards are held for
   review.
2. **The Waitlist sets the pincodes to open next beside who waits** on a wide desk, one above the other short of it.
3. **Care numbers sets what chats were about beside who answered them**, the remedies given beneath, as the redesign
   lays them out.
4. **The Funnel sets the period's returns beside its steps**: the spend, what each first fit cost, the first fits'
   revenue and the return on the spend, all channels together. The steps keep their own counts; the redesign's square
   root scale and step percentages are not drawn.
5. **Activity writes each entry as a sentence** (the owner's ruling of 24 November): who did what to whom, "Sandeep
   Yadav closed the visit for Neha Kapoor", the client or visit a link, under its day ("Today", "Yesterday", or the
   day). A row's time opens what the log kept: who they are and where they acted from, the action and the call, the
   record's kind and ID, and the IDs, counts and codes kept with it. The days shown stand beside the title; Download
   CSV writes the entries shown, the sentence beside the call and the record; the box for pages opened and searches
   stands in the bar; Who, What and the days stay in Filter, and older pages beneath. Every change the console can
   make has its words, held to the console's routes by a test; a client's own record is never named after their name,
   and a record with no name a reader would know is left to the row's details. A client's History tab lists the same
   sentences, each day under a heading inside its panel.

## Consequences

- An action an earlier build logged under a name this one has no words for reads by that name, as before.
- Spend keeps no month beside its title: it lists a range of days, not one month.
- The technical detail Activity's table showed in its columns is a click away, in the row's details.
