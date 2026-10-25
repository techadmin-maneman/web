-- Migration number: 0194
-- What a technician adds at the door when nobody answers: a short note, and one photograph of the door, kept with the
-- no-show case ops rule on (src/domain/no-shows/no-shows.ts). The photograph is under the visit's own folder in R2,
-- so an erasure deletes it with the visit's photographs. Only new columns: the Worker already deployed writes and
-- reads nothing of them.

ALTER TABLE no_show_cases ADD COLUMN door_note TEXT CHECK (door_note IS NULL OR length(door_note) BETWEEN 1 AND 500);
ALTER TABLE no_show_cases ADD COLUMN door_photo_key TEXT;
