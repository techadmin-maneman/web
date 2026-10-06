// What the no-show tests share (ops-no-shows*.test.ts): the client, visit, case and technician they turn on, and the
// terms a visit is sold under.

import { FREE_CHANGE_NOTICE_HOURS, LATE_CHANGE_CHARGES } from "../../../src/policy/moving-a-visit.ts";
import { NO_SHOW_CHARGES } from "../../../src/policy/no-show.ts";

export const PERSON = "11111111-1111-4111-8111-111111111111";

export const VISIT = "22222222-2222-4222-8222-222222222222";

export const CASE = "33333333-3333-4333-8333-333333333333";

export const TECHNICIAN = "44444444-4444-4444-8444-444444444444";

/** The terms before ops set any: a visit no hold sold is charged under them. */
export const COMMITTED_TERMS = {
  changeNoticeHours: FREE_CHANGE_NOTICE_HOURS,
  lateChangeCharges: LATE_CHANGE_CHARGES,
  noShowCharges: NO_SHOW_CHARGES,
};

export interface Case {
  id: string;
  person: { id: string; name: string } | null;
  message_state: string;
  message_delivered_at: string | null;
  opened_at: string;
  due: string;
  decision: string;
}
