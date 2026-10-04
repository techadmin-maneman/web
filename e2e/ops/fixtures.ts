// What the ops routes answer in these tests, one file per board in fixtures/,
// and answer(), which serves them by method and path (answer.ts). The figures
// are the Ops Console board's own (design/phase2/Ops Console.dc.html), so a test
// reads beside the drawing; nothing here is a real person, number, address or
// photograph.
//
// The queues the console reads are empty on a fresh local database, and
// seeding a held grant or a client's photographs would mean writing rows no
// route creates. So the tests that need them answer the API themselves, as
// e2e/app's do for a state the API cannot be put into. Each fixture is typed
// against the console's generated API types, and each reply is checked against
// docs/openapi-ops.json as it is sent (e2e/contract.ts), so none can drift from
// what mm-api answers.

export { answer, empty, fails, jpeg, json, type Answer, type Answers, type Call, type OpsReply } from "./answer.ts";
export {
  CLIENT,
  CONSENTS,
  ERASURE_REQUESTED,
  HAIR_PROFILE,
  NEW_RECORD,
  NO_HAIR_PROFILE,
  PHOTOS,
  PIECES,
  RECORD,
  inkPhoto,
} from "./fixtures/clients.ts";
export { BOARD, MOVED, ROHIT, ROOM, VIKRAM } from "./fixtures/dispatch.ts";
export {
  CHARGE_PREVIEW,
  DAY_MONEY,
  DECIDED,
  DISPUTES,
  DELETION_REQUESTS,
  GRIEVANCES,
  NO_SHOWS,
  NO_SHOW_UNMEASURED,
  NUMBER_CHANGES,
  TASKS,
  TASKS_READ_ON,
} from "./fixtures/queues.ts";
export { HELD, REFERRERS } from "./fixtures/referrals.ts";
export { BLACKOUTS, DISCOUNT_CODES, PRICE_ROWS, SERVICE_AREA, SERVICES, SETTINGS } from "./fixtures/settings.ts";
export { CONSUMABLES, IMRAN, JOB_SHEET, SAMEER, STOCK } from "./fixtures/stock.ts";
export {
  LEAVE_CANCELLED,
  LEAVE_RECORDED,
  NO_LEAVE,
  RAVI,
  SANDEEP_LEAVE,
  SWITCHED_OFF,
  TECHNICIAN_ADDED,
  TECHNICIANS,
  TECHNICIAN_WORK,
} from "./fixtures/technicians.ts";
export { ADDED, AREAS, LAUNCHED, PREVIEW, UNHELD } from "./fixtures/waitlist.ts";
