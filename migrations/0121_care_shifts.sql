-- When each of the Care team went on shift, as they mark it themselves on the Messages page
-- (docs/decisions/0139-care-shifts.md); NULL while off shift. A Care person off shift has their chats covered.
ALTER TABLE staff ADD COLUMN on_shift_since TEXT;
