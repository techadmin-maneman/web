// Whether a number belongs to a test record (src/policy/staging-test-records.ts): the mark stored on the person who
// holds it, or, for a number nobody holds yet, the mark the record a form is about to make would be given.

import type { EnvironmentName } from "../../config/environments.ts";
import { testRecordAtCreation } from "../../policy/staging-test-records.ts";

export async function isTestNumber(
  db: D1Database,
  environment: EnvironmentName | undefined,
  mobileE164: string,
  typedName: string,
): Promise<boolean> {
  const held = await db
    .prepare("SELECT test_record FROM people WHERE mobile_e164 = ?1")
    .bind(mobileE164)
    .first<{ test_record: number }>();
  return held === null ? testRecordAtCreation(environment, typedName) : held.test_record === 1;
}
