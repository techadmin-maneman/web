// The words the Words page set for a message, as the messaging queue reads them for each send
// (docs/decisions/0128-messages-with-the-words-set.md). Apart from ./words.ts, whose list the console reads whole, so
// the queue's path reads only the two lines it needs.

import type { Wording } from "../../config/message-templates.ts";

/**
 * The words set for a message, and for its stop line where it carries one, where they differ from the code's
 * (docs/decisions/0128-messages-with-the-words-set.md); undefined while neither was changed.
 */
export async function messageWording(
  db: D1Database,
  template: string,
  withStop: boolean,
): Promise<Wording | undefined> {
  const text = `message:${template}`;
  const stop = "message:stop_link_v1";
  const { results } = await db
    .prepare(
      `SELECT key, text FROM (
         SELECT key, text, ROW_NUMBER() OVER (PARTITION BY key ORDER BY set_at DESC, rowid DESC) AS n
         FROM word_versions WHERE key IN (?1, ?2)
       ) WHERE n = 1`,
    )
    .bind(text, withStop ? stop : text)
    .all<{ key: string; text: string | null }>();
  const set = (key: string) => results.find((row) => row.key === key)?.text ?? null;
  const textSet = set(text);
  const stopSet = withStop ? set(stop) : null;
  if (textSet === null && stopSet === null) return undefined;
  return { ...(textSet === null ? {} : { text: textSet }), ...(stopSet === null ? {} : { stop: stopSet }) };
}
