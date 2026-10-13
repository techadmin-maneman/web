-- Migration number: 0163
-- A Care thread begun before its number was a client's is linked to the client when they become one or take the
-- number, so an erasure and a data export reach it (docs/decisions/0129-the-care-inbox.md).
--
-- Triggers and a back-fill only: the Worker already deployed reads nothing new.

UPDATE conversations
SET person_id = (SELECT p.id FROM people p WHERE p.mobile_e164 = conversations.mobile_e164 AND p.erased_at IS NULL)
WHERE person_id IS NULL
  AND EXISTS (SELECT 1 FROM people p WHERE p.mobile_e164 = conversations.mobile_e164 AND p.erased_at IS NULL);

CREATE TRIGGER conversations_linked_to_new_person AFTER INSERT ON people
WHEN NEW.erased_at IS NULL
BEGIN
  UPDATE conversations SET person_id = NEW.id WHERE person_id IS NULL AND mobile_e164 = NEW.mobile_e164;
END;

CREATE TRIGGER conversations_linked_to_new_number AFTER UPDATE OF mobile_e164 ON people
WHEN NEW.erased_at IS NULL
BEGIN
  UPDATE conversations SET person_id = NEW.id WHERE person_id IS NULL AND mobile_e164 = NEW.mobile_e164;
END;
