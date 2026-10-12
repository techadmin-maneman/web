-- The Care numbers page (docs/decisions/0144-care-numbers.md) reads the chats opened, and the remedies given, in a
-- period: each by when, so neither reads its whole table.
CREATE INDEX conversations_by_opened ON conversations (opened_at);
CREATE INDEX remedies_by_given ON remedies (given_at);
