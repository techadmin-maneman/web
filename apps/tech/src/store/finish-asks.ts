// How a technician suggested finishing a visit left partly done, kept on the phone until it reaches ops
// (docs/decisions/0246-closed-and-sent-back.md): sent at once with signal, and otherwise once the outbox has sent
// the visit's close, which the suggestion needs to land on.

import { api, unreachable, type FinishAsk } from "../api.ts";
import { get, put } from "./db.ts";
import type { Queued } from "./replay.ts";

async function held(): Promise<Readonly<Record<string, FinishAsk>>> {
  const kept = await get("device", "finish_asks");
  return kept?.key === "finish_asks" ? kept.asks : {};
}

/** Keeps a suggestion that could not go yet, in the place of any kept for the visit before. */
export async function keepFinishAsk(jobId: string, ask: FinishAsk): Promise<void> {
  await put("device", { key: "finish_asks", asks: { ...(await held()), [jobId]: ask } });
}

/** Lets go of the visit's kept suggestion: one sent since, or only `sent`, where another was kept meanwhile. */
export async function dropFinishAsk(jobId: string, sent?: FinishAsk): Promise<void> {
  const kept = await held();
  if (kept[jobId] === undefined || (sent !== undefined && kept[jobId] !== sent)) return;
  const left = Object.fromEntries(Object.entries(kept).filter(([visit]) => visit !== jobId));
  await put("device", { key: "finish_asks", asks: left });
}

/**
 * Sends each suggestion kept: one the API takes goes, as does one it refuses for good. One it cannot take yet stays:
 * with no signal, or while the visit's close is still among the writes on the phone, read only when one is kept. Each
 * is read again before it goes, so one replaced or sent straight meanwhile is never sent over the newer.
 */
export async function sendFinishAsks(onThePhone: () => Promise<readonly Queued[]>): Promise<void> {
  const kept = await held();
  if (Object.keys(kept).length === 0) return;
  const writes = await onThePhone();
  const closing = new Set(writes.filter((event) => event.kind === "outcome").map((event) => event.job_id));
  for (const [jobId, ask] of Object.entries(kept)) {
    if ((await held())[jobId] !== ask) continue;
    const answer = await api.finishAsk(jobId, ask);
    if (answer.ok || !(unreachable(answer) || closing.has(jobId))) await dropFinishAsk(jobId, ask);
  }
}
