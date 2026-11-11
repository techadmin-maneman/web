// What a technician who left a visit partly done, or could not fit, may suggest to ops for finishing it
// (docs/decisions/0246-closed-and-sent-back.md): a time, or that ops call the client. Ops book the visit.

export const FINISH_ASKS = ["tomorrow_morning", "tomorrow_evening", "ops_call"] as const;
export type FinishAsk = (typeof FINISH_ASKS)[number];
