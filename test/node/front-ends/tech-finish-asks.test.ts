// How a technician's suggestion for finishing a visit waits on the phone (apps/tech/src/store/finish-asks.ts,
// docs/decisions/0246-closed-and-sent-back.md): kept with no signal, sent once there is, and never sent over a newer
// one sent straight or chosen since.

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../apps/tech/src/api.ts";
import { deviceRecord, wipe } from "../../../apps/tech/src/store/db.ts";
import { dropFinishAsk, keepFinishAsk, sendFinishAsks } from "../../../apps/tech/src/store/finish-asks.ts";

afterEach(async () => {
  vi.restoreAllMocks();
  await wipe();
});

const kept = async () => {
  const record = await deviceRecord("finish_asks");
  return record?.key === "finish_asks" ? record.asks : {};
};

const sent = () => ({ ok: true, status: 204, body: undefined }) as unknown as Awaited<ReturnType<typeof api.finishAsk>>;

describe("a suggestion for finishing a visit, kept on the phone", () => {
  it("goes once there is signal, and is let go once it has", async () => {
    await keepFinishAsk("visit-a", "tomorrow_morning");
    const finishAsk = vi.spyOn(api, "finishAsk").mockResolvedValue(sent());

    await sendFinishAsks(() => Promise.resolve([]));

    expect(finishAsk).toHaveBeenCalledWith("visit-a", "tomorrow_morning");
    expect(await kept()).toEqual({});
  });

  it("is never sent after a newer one went straight", async () => {
    await keepFinishAsk("visit-a", "tomorrow_morning");
    // The technician chose again with signal: that one landed, and the kept one goes unsent.
    await dropFinishAsk("visit-a");
    const finishAsk = vi.spyOn(api, "finishAsk").mockResolvedValue(sent());

    await sendFinishAsks(() => Promise.resolve([]));

    expect(finishAsk).not.toHaveBeenCalled();
  });

  it("lets go only of the one sent, where another was chosen meanwhile", async () => {
    await keepFinishAsk("visit-a", "tomorrow_morning");
    await keepFinishAsk("visit-a", "ops_call");
    await dropFinishAsk("visit-a", "tomorrow_morning");
    expect(await kept()).toEqual({ "visit-a": "ops_call" });
  });
});
