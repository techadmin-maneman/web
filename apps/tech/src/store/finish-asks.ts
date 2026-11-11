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

/**
 * Sends each suggestion kept: one the API takes goes, as does one it refuses for good. One it cannot take yet stays:
 * with no signal, or while the visit's close is still among the writes on the phone.
 */
export async function sendFinishAsks(onThePhone: readonly Queued[]): Promise<void> {
  const kept = await held();
  if (Object.keys(kept).length === 0) return;
  const closing = new Set(onThePhone.filter((event) => event.kind === "outcome").map((event) => event.job_id));
  const left: Record<string, FinishAsk> = {};
  for (const [jobId, ask] of Object.entries(kept)) {
    const answer = await api.finishAsk(jobId, ask);
    if (!answer.ok && (unreachable(answer) || closing.has(jobId))) left[jobId] = ask;
  }
  await put("device", { key: "finish_asks", asks: left });
}
