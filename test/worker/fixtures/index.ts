// The rows a test starts from, one builder per group of tables, each with its defaults and the test's overrides:
// a new test writes its data through these, never as INSERT statements of its own
// (test/node/tooling/test-data.test.ts).

export { aCreditSpent } from "./credits.ts";
export { aHold } from "./holds.ts";
export { aPayment, aPaymentLink } from "./payments.ts";
export { aGenericFirstFit, aHairSystemOf, aPackage } from "./packages.ts";
export { aConsent, aHairProfile, anAddress, aPerson } from "./people.ts";
export { aTechnician } from "./technicians.ts";
export { aNoShow, aVisit, keepUpVisits } from "./visits.ts";
