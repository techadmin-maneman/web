-- The Staff list is on wherever it was left off: a call beyond a person's grants is refused, not just logged.
-- Bootstrap admins (STAFF_BOOTSTRAP_ADMINS) reach the console while the list is still empty
-- (docs/decisions/0189-the-staff-list-on-by-default.md).
UPDATE staff_access_mode SET enforced = 1, set_by = 'migration 0156', set_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 1 AND enforced = 0;
