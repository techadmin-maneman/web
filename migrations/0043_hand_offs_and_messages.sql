-- Migration number: 0043
-- Hand-offs between surfaces, and the messages people are owed
-- (docs/decisions/0073-hand-offs-and-messages.md).

-- One arrival notice a visit, however often the technician checks in: the
-- no-show's evidence reads its receipt (src/domain/visit-messages.ts).
CREATE UNIQUE INDEX outbound_messages_one_arrival ON outbound_messages (subject_id) WHERE kind = 'arrival_notice';
