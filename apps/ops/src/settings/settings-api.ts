// Settings' calls to mm-api: the rules, what storage and the database hold, blackout days, the day's half-slot times,
// and the job sheet's lists.
// Each is the console's client's (../api.ts), one function a route, so a call is found, and changed, in one place.

import {
  client,
  type OpsSetting,
  type SettingValue,
  type JobSheetItemSent,
  type VisitType,
  type BlackoutAdd,
  type BlackoutRemove,
  type SlotTimesChange,
} from "../api.ts";

export const settingsApi = {
  /** Every rule ops may change, with its unit, its bounds and who last set it (ADR 0061). */
  settings: () => client.get("/api/settings"),
  /** What the photographs and referral cards hold in R2, against their share (ADR 0093). */
  storage: () => client.get("/api/storage"),
  /** One rule. A null value puts the figure in the code back and removes the row. */
  setSetting: (name: OpsSetting["name"], value: SettingValue | null) =>
    client.post("/api/settings/{name}", { path: { name }, body: { value } }),
  /** Every day from today on that no visit is offered, with what is still booked on each. */
  blackouts: () => client.get("/api/blackouts"),
  slotTimes: () => client.get("/api/slot-times"),
  setSlotTimes: (change: SlotTimesChange) => client.post("/api/slot-times", { body: change }),
  withdrawSlotTimes: (from: string) =>
    client.delete("/api/slot-times/{applies_from}", { path: { applies_from: from } }),
  /** The visits still booked on the days from the first to the last, which closing them strands. */
  blackoutsBooked: (period: BlackoutRemove) => client.get("/api/blackouts/booked", { query: period }),
  /** Every day from the first to the last, both included. A day already blacked out takes this reason. */
  addBlackouts: (period: BlackoutAdd) => client.post("/api/blackouts", { body: period }),
  /** The days from the first to the last are offered again. */
  removeBlackouts: (period: BlackoutRemove) => client.post("/api/blackouts/remove", { body: period }),
  jobSheet: () => client.get("/api/job-sheet"),
  /** A kind of visit's whole checklist, in its order. An item left out is retired, not forgotten. */
  setChecklist: (type: VisitType, items: readonly JobSheetItemSent[]) =>
    client.post("/api/job-sheet/checklists/{visit_type}", { path: { visit_type: type }, body: { items: [...items] } }),
  setPartialReasons: (items: readonly JobSheetItemSent[]) =>
    client.post("/api/job-sheet/partial-reasons", { body: { items: [...items] } }),
  setLostReasons: (items: readonly JobSheetItemSent[]) =>
    client.post("/api/job-sheet/lost-reasons", { body: { items: [...items] } }),
};
