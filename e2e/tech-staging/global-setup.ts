// Before the staging proof runs: the fixtures, in the staging database itself.
// The handover is an environment variable, as e2e/global-setup.ts does it.

import { seedStaging } from "./seed.ts";

export default async function globalSetup(): Promise<void> {
  const fixture = await seedStaging();
  // Never the mobile numbers, and never the session token.
  console.log(`staging fixtures seeded: technician ${fixture.technicianId}, jobs ${fixture.today.id} and two more`);
}
