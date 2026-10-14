// JSON kept in a column, read back through the schema of what writes it: a shape changed by a migration, or written
// wrongly, fails where it is read, naming the column, rather than somewhere after as a wrong value.

import type { z } from "zod";

export function storedJson<Schema extends z.ZodType>(schema: Schema, text: string, column: string): z.infer<Schema> {
  const parsed = schema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`${column} holds JSON of another shape: ${parsed.error.message}`);
  return parsed.data;
}
