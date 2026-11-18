// The chats the Messages component tests share (ops-messages.test.ts, ops-messages-reports.test.ts): a client's, a
// number we don't know, and one of our technicians'. Every name and number is made up.

import type { Conversation } from "../../apps/ops/src/care/care-api.ts";

export const ARJUN: Conversation = {
  id: "8c1d9f4b-5e6a-4b7c-9d8e-3f4a5b6c7d8e",
  person: { id: "11111111-1111-4111-8111-111111111111", name: "Arjun Mehta" },
  mobile: "+919810000001",
  state: "open",
  care_person: "asha@maneman.test",
  care_name: null,
  covered_by: null,
  technician: null,
  last_message_at: "2026-09-21T05:12:00.000Z",
  last_line: "Can I move tomorrow’s visit to the evening?",
  waiting_since: "2026-09-21T05:12:00.000Z",
  reply_by: "2026-09-21T06:12:00.000Z",
};

export const STRANGER: Conversation = {
  ...ARJUN,
  id: "9d2e0a5c-6f7b-4c8d-0e9f-4a5b6c7d8e9f",
  person: null,
  care_person: null,
  mobile: "+919811112222",
  last_line: "Do you come to Noida?",
};

/** One of our technicians, on a number a client of ours has too: the chat is the technician's everywhere it is named. */
export const IMRAN: Conversation = {
  ...ARJUN,
  id: "ad3f1b6d-7a8c-4d9e-8f0a-5b6c7d8e9f0a",
  technician: { id: "88000000-0000-4000-8000-000000000001", name: "Imran Qureshi" },
  last_line: "Running ten minutes late.",
};
