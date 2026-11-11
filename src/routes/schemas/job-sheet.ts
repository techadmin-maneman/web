// A job sheet item as the technician's phone has it: its code and the technician's words. The card carries its own
// lists (src/routes/tech/jobs.schemas.ts), and Guides every kind's checklist (src/routes/tech/job-sheet.ts).

import { z } from "@hono/zod-openapi";

/** One item of the job sheet: the code the app sends back, and the words the technician reads. */
export const JobSheetItemSchema = z.object({ id: z.string(), label: z.string() }).strict().openapi("JobSheetItem");
