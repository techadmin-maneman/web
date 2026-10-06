// What the sweeper's tests share (sweeper*.test.ts): times past and to come, the sweep's environment and its options.

import { env } from "cloudflare:workers";
import { createCallBudget } from "../../../src/lib/call-budget.ts";
import { type SweepEnv } from "../../../src/scheduled/sweeper.ts";
import { NOW, fakeQueue } from "../helpers.ts";

export const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

export const minutesAhead = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

export function sweepEnv() {
  const queues = { crm: fakeQueue(), render: fakeQueue(), messages: fakeQueue() };
  const bindings: SweepEnv = {
    DB: env.DB,
    UPLOADS: env.UPLOADS,
    RESULTS: env.RESULTS,
    CLIENT_PHOTOS: env.CLIENT_PHOTOS,
    CRM_QUEUE: queues.crm,
    RENDER_QUEUE: queues.render,
    MESSAGE_QUEUE: queues.messages,
  };
  return { bindings, queues };
}

export const OPTIONS = { budget: createCallBudget(Infinity) };
