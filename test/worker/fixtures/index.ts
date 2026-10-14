// The rows a test starts from, one builder per group of tables, each with its defaults and the test's overrides:
// a new test writes its data through these, never as INSERT statements of its own
// (test/node/tooling/test-data.test.ts).

export { aHold } from "./holds.ts";
export { aPayment } from "./payments.ts";
export { anAddress, aPerson } from "./people.ts";
export { aTechnician } from "./technicians.ts";
export { aVisit, keepUpVisits } from "./visits.ts";
