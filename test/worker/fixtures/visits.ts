// A visit on the books: a service visit in Gurgaon, booked for 10:30 on Tuesday 22 September, India's time, for
// ninety minutes, unless the test says otherwise.

import { AT, writeRow, type RowOf } from "./rows.ts";

export const aVisit = (row: RowOf<"appointments"> = {}) => {
  const id = row.id ?? crypto.randomUUID();
  return writeRow(
    "appointments",
    {
      id,
      fsm_id: id,
      type: "service",
      status: "scheduled",
      window_start: "2026-09-22T05:00:00.000Z",
      window_end: "2026-09-22T06:30:00.000Z",
      service_city: "Gurgaon",
      service_pincode: "122018",
      synced_at: AT,
    },
    row,
  );
};
