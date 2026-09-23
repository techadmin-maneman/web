// After the staging proof, pass or fail: everything it wrote comes back out of
// staging. It runs promptly on purpose (e2e/tech-staging/seed.ts, clearStaging).

import { clearStaging, stagingFixture } from "./seed.ts";

export default async function globalTeardown(): Promise<void> {
  await clearStaging(stagingFixture());
  console.log("staging fixtures cleared");
}
