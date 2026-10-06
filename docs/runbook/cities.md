# Cities and visit days

Part of the [runbook](../runbook.md), whose opening says how its commands are written.

Where we come is decided by the pincode, which ops open from the console (Growth · Service area, ADR 0061), and serving a pincode tells its waitlist. The `cities` table is Phase 1's: its form offered them, and `POST /api/lead` and `GET /api/cities`, which read it, were removed on 28 September 2026 (`docs/open-points.md`, item 107). A booking's lead still names its pincode's city where it is one of these, and the dispatch board filters by them, so a city is a data change, not a deploy:

```sql
-- Add a city the dispatch board can filter by, after Bengaluru.
INSERT INTO cities (name, served, active, sort) VALUES ('Pune', 1, 1, 80);
-- Take a city off the board's filter. Existing leads keep it.
UPDATE cities SET active = 0 WHERE name = 'Pune';
```

Blackout days are days no visit is offered, in the app or from the site. Ops add and remove them in the console, Settings · Blackout days, with a reason; each change is audited under the Access identity that made it (ADR 0088), and the runbook's SQL is no longer the way. A blackout moves no visit already booked on the day: the screen says how many are, and ops move them on the dispatch board.

---
