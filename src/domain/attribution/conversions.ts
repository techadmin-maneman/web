// A lead left on /book's first step, as a conversion (docs/decisions/0288-attribution-and-conversions.md), under the
// event ID the browser's Pixel sent with its own copy, so Meta counts the two once. Google hears of it from GA4 in the
// browser, so its server copy is not for Google. The others are recorded beside the writes that bring them about
// (./conversion-upkeep.ts).

/** Records the lead's conversion, once; a test record's is never sent. */
export async function recordLeadConversion(
  db: D1Database,
  lead: {
    readonly eventId: string;
    readonly leadId: string;
    readonly personId: string;
    /** The page it was left on, which Meta asks of a website's event. */
    readonly sourceUrl: string | null;
    readonly now: Date;
  },
): Promise<void> {
  const at = lead.now.toISOString();
  await db
    .prepare(
      `INSERT INTO conversions (event_id, event, subject_id, person_id, occurred_at, attributed_channel,
         last_touch_channel, source_url, meta_state, meta_error, meta_next_at, google_state, google_error, created_at)
       SELECT ?1, 'lead_submit', ?2, p.id, ?4, COALESCE(pa.attributed_channel, 'direct'),
         COALESCE(pa.last_touch_channel, 'direct'), ?5,
         CASE WHEN p.test_record = 1 THEN 'skipped' ELSE 'pending' END,
         CASE WHEN p.test_record = 1 THEN 'test_record' END, ?4, 'skipped', 'browser_only', ?4
       FROM people p LEFT JOIN person_attribution pa ON pa.person_id = p.id WHERE p.id = ?3
       ON CONFLICT DO NOTHING`,
    )
    .bind(lead.eventId, lead.leadId, lead.personId, at, lead.sourceUrl)
    .run();
}
