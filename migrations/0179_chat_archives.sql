-- A client's Care thread, closed and quiet for a year, has its messages moved out of D1 into the backups bucket, one
-- file for the thread (docs/decisions/0207-closed-chats-archived.md). Where that file is, how many messages it holds,
-- and the thread's last message when it was written: a thread written to again since is archived again once it is
-- quiet a year more.
ALTER TABLE conversations ADD COLUMN archive_key TEXT;
ALTER TABLE conversations ADD COLUMN archived_messages INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN archived_through TEXT;

-- The threads waiting to be archived, oldest first: a client's, closed, and not archived since its last message. Once
-- archived a thread leaves it, so the job reads what it has to do and never the threads it did.
CREATE INDEX conversations_to_archive ON conversations (last_message_at)
  WHERE state = 'closed' AND person_id IS NOT NULL AND (archived_through IS NULL OR archived_through <> last_message_at);
