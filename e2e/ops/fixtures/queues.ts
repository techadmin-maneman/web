// Boards D1 and D2, and the three DPDP queues no board draws: the no-shows ops
// rule on, the day's money, what ops still have to do, and the grievances,
// deletion requests and number changes waiting on them.

import type { OpsReply } from "../answer.ts";
import { CLIENT } from "./clients.ts";

/**
 * The board's own case: Vikram's visit was booked for 11:30, the technician
 * checked in at 11:31, 240 m out against a 200 m fence, the WhatsApp was delivered at 11:32, and he
 * closed the job at 11:47. The second is a client who never agreed to WhatsApp
 * about visits, so no reminder went; its check-in reached us twenty minutes
 * after the phone's own time. Each is due two days after it opened.
 */
const VIKRAMS_CASE = {
  id: "66000000-0000-4000-8000-000000000001",
  appointment_id: "77000000-0000-4000-8000-000000000001",
  person: { id: "11000000-0000-4000-8000-000000000002", name: "Vikram Sethi" },
  visit_date: "2027-09-19",
  technician: "Imran Qureshi",
  checked_in_at: "2027-09-19T06:01:00.000Z",
  phone_checked_in_at: "2027-09-19T06:01:00.000Z",
  received_at: "2027-09-19T06:01:00.000Z",
  window_start: "2027-09-19T06:00:00.000Z",
  window_end: "2027-09-19T07:30:00.000Z",
  minutes_late: 1,
  distance_m: 240,
  let_in: null,
  radius_m: 200,
  message_state: "delivered",
  message_delivered_at: "2027-09-19T06:02:00.000Z",
  wait_ends_at: "2027-09-19T06:16:00.000Z",
  closed_early: false,
  closed_at: "2027-09-19T06:17:00.000Z",
  opened_at: "2027-09-19T06:17:00.000Z",
  due: "2027-09-21T06:17:00.000Z",
  decision: "undecided",
  decided_at: null,
} satisfies OpsReply<"/api/no-shows">["cases"][number];

export const NO_SHOWS = {
  waiver: { payment: "refunded", credit: "returned" },
  cases: [
    VIKRAMS_CASE,
    {
      id: "66000000-0000-4000-8000-000000000002",
      appointment_id: "77000000-0000-4000-8000-000000000002",
      person: { id: CLIENT.id, name: CLIENT.name },
      visit_date: "2027-09-20",
      technician: "Sandeep Yadav",
      checked_in_at: "2027-09-20T04:30:00.000Z",
      phone_checked_in_at: "2027-09-20T04:30:00.000Z",
      received_at: "2027-09-20T04:50:00.000Z",
      window_start: "2027-09-20T03:30:00.000Z",
      window_end: "2027-09-20T06:30:00.000Z",
      minutes_late: 60,
      distance_m: 12,
      let_in: null,
      radius_m: 200,
      message_state: "no_consent",
      message_delivered_at: null,
      wait_ends_at: "2027-09-20T05:05:00.000Z",
      closed_early: false,
      closed_at: "2027-09-20T05:06:00.000Z",
      opened_at: "2027-09-20T05:06:00.000Z",
      due: "2027-09-22T05:06:00.000Z",
      decision: "undecided",
      decided_at: null,
    },
  ],
} satisfies OpsReply<"/api/no-shows">;

/**
 * The same case with nothing measured: the address had no coordinates, so the
 * route carries no distance at all (docs/decisions/0036-geocoding.md).
 */
export const NO_SHOW_UNMEASURED = {
  waiver: { payment: "refunded", credit: "returned" },
  cases: [{ ...VIKRAMS_CASE, distance_m: null }],
} satisfies OpsReply<"/api/no-shows">;

/** What charging Vikram's visit would do: his service visit was paid Rs. 2,360, and a no-show keeps all of it. */
export const CHARGE_PREVIEW = {
  paid: 236_000,
  kept: 236_000,
  credit_kept: false,
} satisfies OpsReply<"/api/no-shows/{id}/charge">;

/** The cases ruled on today: Karan's charged at 10:30 am, keeping Rs. 2,360, and one waived at 9:05. */
export const DECIDED = {
  cases: [
    {
      id: "66000000-0000-4000-8000-000000000003",
      person: { id: "11000000-0000-4000-8000-000000000005", name: "Karan Bose" },
      visit_date: "2027-09-21",
      decision: "charged",
      decided_at: "2027-09-22T05:00:00.000Z",
      charge: { kept: 236_000, credit_spent: false },
    },
    {
      id: "66000000-0000-4000-8000-000000000004",
      person: { id: "11000000-0000-4000-8000-000000000006", name: "Arjun Mehra" },
      visit_date: "2027-09-20",
      decision: "waived",
      decided_at: "2027-09-22T03:35:00.000Z",
      charge: null,
    },
  ],
} satisfies OpsReply<"/api/no-shows/decided">;

/**
 * Board D1's first card: the day's three figures, and the two charges beneath
 * them. The amounts are the board's own, in paise as the route answers them.
 * The late cancellation carries its evidence, "cancelled 9:14 am · visit was
 * 10 am"; the no-show carries what its charge kept, added to the figure.
 */
export const DAY_MONEY = {
  date: "2027-09-22",
  collected: 8_400_000,
  refunds_processing: 708_000,
  refunded: 236_000,
  charged: 472_000,
  charges: [
    {
      id: "b1000000-0000-4000-8000-000000000001",
      kind: "late_cancellation",
      person: { id: "11000000-0000-4000-8000-000000000002", name: "Vikram Sethi" },
      amount: 236_000,
      at: "2027-09-22T03:44:00.000Z",
      visit_started_at: "2027-09-22T04:30:00.000Z",
      change: "cancelled",
      technician: null,
    },
    {
      id: "b1000000-0000-4000-8000-000000000002",
      kind: "no_show",
      person: { id: "11000000-0000-4000-8000-000000000005", name: "Karan Bose" },
      amount: 236_000,
      at: "2027-09-22T05:00:00.000Z",
      visit_started_at: "2027-09-22T06:00:00.000Z",
      change: null,
      technician: "Imran Qureshi",
    },
  ],
} satisfies OpsReply<"/api/payments">;

/**
 * Board D1's second card: Vikram disputes the charge on a visit he was not home
 * for, 240 m out against a 200 m fence, the one fact that argues for him.
 */
export const DISPUTES = {
  disputes: [
    {
      id: "dd000000-0000-4000-8000-000000000001",
      case_id: "66000000-0000-4000-8000-000000000009",
      appointment_id: "77000000-0000-4000-8000-000000000009",
      person: { id: "11000000-0000-4000-8000-000000000002", name: "Vikram Sethi", mobile: "+919810060916" },
      reason: "I was home all morning. Nobody rang the bell.",
      raised_at: "2027-09-21T06:00:00.000Z",
      due: "2027-09-23T06:00:00.000Z",
      kept: 236_000,
      credit_spent: false,
      window_start: "2027-09-18T06:00:00.000Z",
      checked_in_at: "2027-09-18T06:01:00.000Z",
      phone_checked_in_at: "2027-09-18T06:01:00.000Z",
      received_at: "2027-09-18T06:01:00.000Z",
      distance_m: 240,
      radius_m: 200,
      message_state: "delivered",
      message_delivered_at: "2027-09-18T06:02:00.000Z",
      closed_at: "2027-09-18T06:17:00.000Z",
    },
  ],
} satisfies OpsReply<"/api/no-shows/disputes">;

/**
 * Read against 22 September 2027 in India, the day the tests and the fidelity
 * run set their clock to. Four have run over, as the board's head writes, and
 * each task's `due` is its `since` plus the placeholder two days
 * (src/policy/tasks.ts), so the days left are the board's own: "2 days left",
 * "Due today", "3 days overdue". Five are Priya's or Anil's, as the board's owners are, and
 * three nobody's yet.
 */
export const TASKS = {
  overdue: 4,
  truncated: false,
  low_stock_places: 0,
  staff: ["anil@maneman.in", "ops@localhost", "priya@maneman.in"],
  groups: [
    {
      group: "replacement_order",
      count: 2,
      closable: false,
      tasks: [
        {
          id: "91000000-0000-4000-8000-000000000001",
          person: { id: "22000000-0000-4000-8000-000000000002", name: "Kunal Mehta" },
          detail: "MM-STD-4417-K 2027-10-17",
          since: "2027-09-16T18:30:00.000Z",
          due: "2027-09-18T18:30:00.000Z",
          owner: "priya@maneman.in",
        },
        {
          id: "91000000-0000-4000-8000-000000000002",
          person: { id: CLIENT.id, name: CLIENT.name },
          detail: "MM-STD-4417-C 2027-09-22",
          since: "2027-09-21T18:30:00.000Z",
          due: "2027-09-23T18:30:00.000Z",
          owner: "priya@maneman.in",
        },
      ],
    },
    {
      group: "referral_review",
      count: 2,
      closable: false,
      tasks: [
        {
          id: "92000000-0000-4000-8000-000000000001",
          person: { id: "22000000-0000-4000-8000-000000000003", name: "Rohan Bhalla" },
          detail: "shared_address",
          since: "2027-09-17T06:00:00.000Z",
          due: "2027-09-19T06:00:00.000Z",
          owner: "anil@maneman.in",
        },
        {
          id: "92000000-0000-4000-8000-000000000002",
          person: { id: "22000000-0000-4000-8000-000000000004", name: "Karan Bose" },
          detail: "monthly_cap",
          since: "2027-09-20T06:00:00.000Z",
          due: "2027-09-22T06:00:00.000Z",
          owner: "anil@maneman.in",
        },
      ],
    },
    {
      group: "no_show_decision",
      count: 2,
      closable: false,
      tasks: [
        {
          id: "66000000-0000-4000-8000-000000000001",
          person: { id: "22000000-0000-4000-8000-000000000010", name: "Deepak Rao" },
          detail: "Imran Qureshi",
          since: "2027-09-19T06:17:00.000Z",
          due: "2027-09-21T06:17:00.000Z",
          owner: null,
        },
        {
          id: "66000000-0000-4000-8000-000000000002",
          person: { id: "22000000-0000-4000-8000-000000000011", name: "Sanjay Bhatia" },
          detail: "Sandeep Yadav",
          since: "2027-09-20T04:46:00.000Z",
          due: "2027-09-22T04:46:00.000Z",
          owner: null,
        },
      ],
    },
    {
      group: "number_change",
      count: 1,
      closable: false,
      tasks: [
        {
          id: "94000000-0000-4000-8000-000000000001",
          person: { id: "22000000-0000-4000-8000-000000000005", name: "Vikram Sethi" },
          detail: null,
          since: "2027-09-18T06:00:00.000Z",
          due: "2027-09-20T06:00:00.000Z",
          owner: "priya@maneman.in",
        },
      ],
    },
    {
      group: "erasure_request",
      count: 1,
      closable: false,
      tasks: [
        {
          id: "95000000-0000-4000-8000-000000000001",
          person: { id: "22000000-0000-4000-8000-000000000006", name: "Ashish Gill" },
          detail: null,
          since: "2027-09-21T06:00:00.000Z",
          due: "2027-09-23T06:00:00.000Z",
          owner: null,
        },
      ],
    },
  ],
} satisfies OpsReply<"/api/tasks">;

/** The day the board's tasks are read against: 10:30 in India on 22 September 2027. */
export const TASKS_READ_ON = new Date("2027-09-22T05:00:00.000Z");

/**
 * Read against 22 September 2027 in India, as board D2's tasks are, so the days
 * left read the same on every run: the first grievance is within the 30 days the
 * app promises and the second is past them; of the deletion requests the first
 * is within its 30 days, the second is past them and the third falls due today.
 * The numbers are made up, as everywhere else here, and the words are nobody's.
 */
export const GRIEVANCES = {
  grievances: [
    {
      id: "a1000000-0000-4000-8000-000000000001",
      person_id: CLIENT.id,
      name: CLIENT.name,
      mobile: CLIENT.mobile,
      text: "I asked for the WhatsApp messages about launches to stop and they have not stopped.",
      raised_at: "2027-09-14T06:00:00.000Z",
      due: "2027-10-14T06:00:00.000Z",
    },
    {
      id: "a1000000-0000-4000-8000-000000000002",
      person_id: "22000000-0000-4000-8000-000000000007",
      name: "Vikram Sethi",
      mobile: "+919810004418",
      text: "Who saw my photographs, and when?",
      raised_at: "2027-08-01T06:00:00.000Z",
      due: "2027-08-31T06:00:00.000Z",
    },
  ],
} satisfies OpsReply<"/api/grievances">;

export const DELETION_REQUESTS = {
  requests: [
    {
      id: "a2000000-0000-4000-8000-000000000001",
      person_id: CLIENT.id,
      name: CLIENT.name,
      mobile: CLIENT.mobile,
      requested_at: "2027-08-28T06:00:00.000Z",
      due: "2027-09-27T06:00:00.000Z",
    },
    {
      id: "a2000000-0000-4000-8000-000000000002",
      person_id: "22000000-0000-4000-8000-000000000008",
      name: "Ashish Gill",
      mobile: "+919810004419",
      requested_at: "2027-08-18T06:00:00.000Z",
      due: "2027-09-17T06:00:00.000Z",
    },
    {
      id: "a2000000-0000-4000-8000-000000000003",
      person_id: "22000000-0000-4000-8000-000000000009",
      name: "Karan Bose",
      mobile: "+919810004420",
      requested_at: "2027-08-23T06:00:00.000Z",
      due: "2027-09-22T06:00:00.000Z",
    },
  ],
} satisfies OpsReply<"/api/deletion-requests">;

export const NUMBER_CHANGES = {
  changes: [
    {
      id: "a3000000-0000-4000-8000-000000000001",
      person_id: CLIENT.id,
      name: CLIENT.name,
      old_mobile: CLIENT.mobile,
      new_mobile: "+919810004421",
      new_number_held_by: null,
      requested_at: "2027-09-21T06:00:00.000Z",
      due: "2027-09-23T06:00:00.000Z",
    },
  ],
} satisfies OpsReply<"/api/number-changes">;
