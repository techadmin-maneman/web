// Before any test runs: a fitted client in the local mirrors, for the client
// app's read surfaces (e2e/app/fitted.ts), two clients whose visits the change
// tests move and cancel (e2e/app/changing.ts), and the service area the booking
// pages read (e2e/booking-area.ts).

import { seedChanging } from "./app/changing.ts";
import { seedFitted } from "./app/fitted.ts";
import { seedBookingArea } from "./booking-area.ts";

export default async function globalSetup(): Promise<void> {
  await seedFitted();
  await seedChanging();
  await seedBookingArea();
}
