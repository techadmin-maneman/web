-- Migration number: 0171
-- The try-on on YouCam (docs/decisions/0201-the-try-on-on-youcam.md): what the page says of a photograph YouCam
-- refused, or of a try-on paused, beside the coarse failure code; and the render each look is, so the same photograph
-- in the same look is made once and its image copied for every repeat.

ALTER TABLE tryon_jobs ADD COLUMN failure_reason TEXT
  CHECK (failure_reason IN ('no_face', 'no_shoulders', 'face_angle', 'several_people', 'not_styleable', 'refused',
    'unavailable'));
-- A sha256 over the photograph's own bytes, the look and the references' version.
ALTER TABLE tryon_jobs ADD COLUMN render_key TEXT;
-- The renders YouCam took for the job: one more is made when its model fails or runs out of time.
ALTER TABLE tryon_jobs ADD COLUMN renders INTEGER NOT NULL DEFAULT 0;
CREATE INDEX tryon_jobs_by_render ON tryon_jobs (render_key) WHERE state = 'ready' AND result_key IS NOT NULL;
