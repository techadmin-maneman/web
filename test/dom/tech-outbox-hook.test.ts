// The technician app's one reader of the outbox (apps/tech/src/lib/useOutbox.ts), which App passes to every screen:
// read once at the start, and again whenever the outbox changes.

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { useOutboxSubscription } from "../../apps/tech/src/lib/useOutbox.ts";
import { wipe } from "../../apps/tech/src/store/db.ts";
import { keepFrame, queue } from "../../apps/tech/src/store/outbox.ts";
import { renderHook, settled } from "./render-hook.ts";

afterEach(async () => {
  await wipe();
});

/** Lets the store's reads finish and reach the page: a few turns, since IndexedDB answers on its own schedule. */
async function readsDone(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await settled();
}

describe("the outbox's one reader", () => {
  it("is unread until the outbox has been read, then holds what is waiting", async () => {
    await queue("start", "a", null);
    const hook = renderHook(() => useOutboxSubscription());
    expect(hook.current().read).toBe(false);
    await readsDone();
    expect(hook.current()).toMatchObject({ read: true, events: [expect.objectContaining({ kind: "start" })] });
    hook.unmount();
  });

  it("reads again whenever a write or a photograph is kept", async () => {
    const hook = renderHook(() => useOutboxSubscription());
    await readsDone();
    expect(hook.current().events).toEqual([]);

    await queue("start", "a", null);
    await keepFrame({ jobId: "a", angle: "front", phase: "before", frame: new Blob(["frame"]) });
    await readsDone();
    expect(hook.current().events).toHaveLength(1);
    expect(hook.current().frames).toHaveLength(1);
    hook.unmount();
  });
});
