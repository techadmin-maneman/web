-- Migration number: 0050
-- The visits a next service follows: a first fit, a service or a replacement,
-- done, by when they were done (docs/decisions/0086-the-next-visit-is-offered.md).
-- The five-minute cron's reminder pass reads the week of them whose next
-- service falls due soon, and the Tasks board's At-risk client those done long
-- enough ago, without either reading a cancelled visit or a consultation among
-- them (ADR 0009; test/node/query-plans.test.ts). Only an index is added, so the
-- Worker already deployed is unaffected.

CREATE INDEX appointments_done_visits ON appointments (window_start)
  WHERE status = 'completed' AND type IN ('first_fit', 'service', 'replacement') AND deleted_at IS NULL;
