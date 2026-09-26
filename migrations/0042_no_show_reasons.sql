-- Migration number: 0042
--
-- Why ops charged or waived a no-show. "Charge or waive, with a reason"
-- (docs/prompts/phase2-frontend.md), and the route now refuses a ruling
-- without one (src/policy/decision-reasons.ts). It is kept with the ruling,
-- beside decided_by, as a held grant keeps review_reason; the audit log names
-- the ruling and never holds what ops wrote.
--
-- Nullable, and only added: every case ruled before now has none, and the code
-- already deployed names its columns and never reads this one.

ALTER TABLE no_show_cases ADD COLUMN decision_reason TEXT;
