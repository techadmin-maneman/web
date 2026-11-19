# 0280. The technician app's Hindi corrected, and the job card's arrival named

- Status: accepted
- Date: 2026-11-19
- Topic: Field work
- Amends [0251](0251-hindi-and-the-sign-in.md) on which catalog wins where two word the same line

## Context

The app's Hindi comes from the prototype's draft catalog (`design/tech-redesign/strings-hi.json`), then the app's own
file for the lines the prototype does not draw (`apps/tech/src/lang/app-hi.json`); where both worded a line, the
catalog's won. The QA run of November 2026 found the most-seen words read as a translation: "Next" as आगे ("ahead")
where Hindi says अगला, "Me" as मैं (the pronoun), "Day view" as दिन का नक्शा ("the day's map") beside a real map, and
others. The design folder is read-only as received, so the catalog is not the place to correct them.

The job card's header gave the client's arrival window as a bare range, "11:11 to 11:41 am", which read as a 30-minute
visit beside Today's "1 h 30 min". The prototype's header writes `{{ job.when }}` with the visit's span as its sample;
the card has shown the arrival window instead since the owner's calls of 12 November.

## Decision

1. **The app's own file wins** where it and the catalog word the same line or template
   (`apps/tech/src/lang/hindi.ts`). Every line both worded before this read the same in each, so nothing else changes.
2. **Its corrections:**
   - Next अगला, and the lines that tell the technician to tap it, "… अगला दबाएँ।";
   - Prepaid पेमेंट हो चुका;
   - Navigate रास्ता देखें;
   - Me प्रोफ़ाइल;
   - Day view पूरा दिन;
   - Nothing booked कोई बुकिंग नहीं;
   - the kit's and Me's empty lines in plain Hindi grammar.
3. **The arrival window is named:** "Arrive 11:11 to 11:41 am · service visit · prepaid", as the client app says
   "Arrives"; in Hindi "11:11 से 11:41 am के बीच पहुँचें". The prototype stays as received.

## Consequences

- The catalog and the app's file can disagree, and the app's file says what a technician reads.
- The Hindi is still a draft: a native speaker's review is owed before it is called final.
