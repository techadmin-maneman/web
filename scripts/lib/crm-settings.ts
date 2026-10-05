// What the CRM's settings API answers about the Leads module, as scripts/check-zoho-setup.ts and scripts/setup-crm.ts
// read it. Each object is loose: Zoho sends many more keys than these, and only these are read.

import { z } from "zod";

export const LEAD_FIELD = z.looseObject({
  id: z.string(),
  api_name: z.string(),
  field_label: z.string(),
  data_type: z.string(),
  pick_list_values: z
    .array(z.looseObject({ id: z.string().optional(), display_value: z.string(), actual_value: z.string() }))
    .optional(),
  /** `{}` when duplicates are allowed; `{ case_sensitive: … }` when they are not. */
  unique: z.record(z.string(), z.unknown()).optional(),
});
export type LeadField = z.infer<typeof LEAD_FIELD>;

export const LEAD_FIELDS = z.looseObject({ fields: z.array(LEAD_FIELD) });

/** An empty list answers 204 with no body: an org with no assignment rules yet. */
export const ASSIGNMENT_RULES = z
  .looseObject({
    assignment_rules: z
      .array(z.looseObject({ id: z.string(), name: z.string(), module: z.looseObject({ api_name: z.string() }) }))
      .optional(),
  })
  .nullable();

/** What a write to the settings API answers: a code and a message for each field. */
const FIELD_WRITE = z
  .looseObject({
    fields: z.array(z.looseObject({ code: z.string().optional(), message: z.string().optional() })).optional(),
  })
  .nullable();

/** Whether Zoho took the field written. */
export const fieldWritten = (json: unknown): boolean =>
  FIELD_WRITE.safeParse(json).data?.fields?.[0]?.code === "SUCCESS";

/** What Zoho says went wrong with a field written, from the shape its settings APIs answer in. */
export function fieldProblem(json: unknown): string {
  const first = FIELD_WRITE.safeParse(json).data?.fields?.[0];
  return `${first?.code ?? "unknown"}: ${first?.message ?? JSON.stringify(json)}`;
}
