// Before any test runs: a fitted client in the local mirrors, for the client
// app's read surfaces (e2e/app/fitted.ts), and two clients whose visits the
// change tests move and cancel (e2e/app/changing.ts).

import { seedChanging } from "./app/changing.ts";
import { seedFitted } from "./app/fitted.ts";

export default async function globalSetup(): Promise<void> {
  await seedFitted();
  await seedChanging();
}
