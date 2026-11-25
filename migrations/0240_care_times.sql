-- Migration number: 0240
-- Customer Care's times to the minute (docs/decisions/0322-care-times.md): care_times holds what care_hours held, its
-- opening, closing and answered-by hours in minutes past midnight, so Care may open at 9:30. care_hours stays for the
-- release before this one; nothing is copied where ops never set it, and the committed default stands.
-- backfill: one row at most (the care_hours setting) x (1 + 0 indexes) on ops_settings: one write.

INSERT INTO ops_settings (name, value, set_by, set_at)
SELECT 'care_times',
  json_object(
    'opens', json_extract(value, '$.opens') * 60,
    'closes', json_extract(value, '$.closes') * 60,
    'first_reply', json_extract(value, '$.first_reply'),
    'answered_by', json_extract(value, '$.answered_by') * 60
  ),
  set_by, set_at
FROM ops_settings WHERE name = 'care_hours'
ON CONFLICT (name) DO NOTHING;
