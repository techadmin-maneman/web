-- Migration number: 0045
-- A client's try-on, kept (docs/decisions/0084-a-clients-try-on-is-kept.md): the small copy of the photograph a
-- client keeps as their before photo, when their try-on was kept, and where its look went to be kept until their
-- first fit is photographed. Only columns and indexes are added; the Worker already deployed reads none of them.

-- The photograph's small copy in the client-photos bucket (tryons/<job>/before.jpg), from its upload until the
-- sweeper deletes it: with the photograph, with the look, or never once the try-on is kept. Blank once deleted.
ALTER TABLE tryon_jobs ADD COLUMN copy_key TEXT;

-- When the sweeper kept the try-on, on its look's last day: its person had booked a visit by then.
ALTER TABLE tryon_jobs ADD COLUMN kept_at TEXT;

-- The kept look, moved to the client-photos bucket (tryons/<job>/look.<ext>), where no lifecycle rule can take it,
-- until the client's first fit is photographed. Blank once deleted.
ALTER TABLE tryon_jobs ADD COLUMN kept_look_key TEXT;

-- A client keeps one try-on (src/policy/kept-try-ons.ts).
CREATE UNIQUE INDEX tryon_jobs_one_kept ON tryon_jobs (person_id) WHERE kept_at IS NOT NULL;

-- The sweeper lets a kept look go once the client's first fit is photographed, finding the sets of the last few
-- days rather than every set there is (src/domain/kept-try-ons.ts).
CREATE INDEX photo_sets_by_created ON photo_sets (created_at);
