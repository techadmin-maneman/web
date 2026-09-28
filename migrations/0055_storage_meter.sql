-- Migration number: 0055
-- The storage meter, and a visit photograph's small copy (docs/decisions/0093-the-storage-meter.md). Only tables and a
-- column are added; the Worker already deployed reads none of them, and a photograph it stores leaves the column
-- empty, which the client app reads as a photograph with no small copy.

-- The small copy the technician's phone makes of each photograph for the client app's rows, in the client-photos
-- bucket beside it (visits/<appointment>/<phase>-<angle>-<take>-small.jpg). Empty for a photograph copied from FSM,
-- or taken before the phone made one: the app shows the photograph itself.
ALTER TABLE photos ADD COLUMN thumbnail_key TEXT;

-- Each object Phase 2's two buckets hold, client-photos and referral-cards, and its size, written as it is stored
-- and deleted as it is (src/domain/storage-meter.ts). An object stored again under its key replaces its row, and a
-- delete takes off only what a row says, so the figure below never counts one object twice. The two buckets' keys
-- never meet: cards/ is referral-cards', and visits/ and tryons/ are client-photos'.
CREATE TABLE stored_objects (
  key TEXT PRIMARY KEY,
  bytes INTEGER NOT NULL CHECK (bytes >= 0)
);

-- What they hold together, kept in the same batch as each row above, so reading it sums nothing.
-- told_percent is the last mark ops were told of (src/policy/storage-share.ts): 0, 50, 80 or 100.
CREATE TABLE storage_meter (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  told_percent INTEGER NOT NULL DEFAULT 0
);

-- Started from the rows. A photograph's row records its size. A referral card, a try-on's small copy and a kept look
-- are counted at their upload limits, since no row records theirs (MAX_CARD_BYTES, MAX_COPY_BYTES and
-- MAX_RESULT_BYTES), so the figure starts high rather than low. A photograph taken again at the same angle leaves
-- the one it replaced in the bucket and in no row, so it is not counted, and its delete takes nothing off; the
-- runbook's "R2 storage growing" says how to true the figure up against the bucket's own size.
INSERT INTO stored_objects (key, bytes) SELECT r2_key, bytes FROM photos;
INSERT INTO stored_objects (key, bytes) SELECT card_key, 307200 FROM referral_codes WHERE card_key IS NOT NULL;
INSERT INTO stored_objects (key, bytes) SELECT copy_key, 256000 FROM tryon_jobs WHERE copy_key IS NOT NULL;
INSERT INTO stored_objects (key, bytes) SELECT kept_look_key, 5242880 FROM tryon_jobs WHERE kept_look_key IS NOT NULL;
INSERT INTO storage_meter (id, bytes) VALUES (1, (SELECT COALESCE(SUM(bytes), 0) FROM stored_objects));
