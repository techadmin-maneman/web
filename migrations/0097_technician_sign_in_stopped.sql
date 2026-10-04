-- Migration number: 0097
-- When ops stopped a technician signing in, by revoking one of his phones: a lost phone, or a fresh browser on it, can
-- still be sent his code on WhatsApp, so no phone of his signs in again until ops let him (src/domain/technicians.ts).
-- Null while he may sign in.
--
-- Expand only: a new column, empty. The Worker already deployed names none of it.

ALTER TABLE technicians ADD COLUMN sign_in_stopped_at TEXT;
