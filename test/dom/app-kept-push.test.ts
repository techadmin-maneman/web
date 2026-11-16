// The push key the client app subscribes this phone with (apps/app/src/alerts/kept-push.ts): read from the inbox once a
// session, read again after a read that failed, and forgotten at sign-out.

import { afterEach, describe, expect, it, vi } from "vitest";
import { contractChecked } from "./contract-fetch.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** The inbox answered as the API would, counting each read; `failing` first reads refused. */
function inbox(failing = 0) {
  let reads = 0;
  vi.stubGlobal(
    "fetch",
    contractChecked("client", () => {
      reads += 1;
      if (reads <= failing) {
        return Promise.resolve(
          Response.json({ error: { code: "internal_error", request_id: "dom" } }, { status: 500 }),
        );
      }
      return Promise.resolve(Response.json({ alerts: [], push_key: "BPublicKey" }));
    }),
  );
  return () => reads;
}

describe("the push key", () => {
  it("is read from the inbox once a session", async () => {
    const reads = inbox();
    const { pushKeyNow } = await import("../../apps/app/src/alerts/kept-push.ts");
    expect(await pushKeyNow()).toBe("BPublicKey");
    expect(await pushKeyNow()).toBe("BPublicKey");
    expect(reads()).toBe(1);
  });

  it("is read again after a read that failed", async () => {
    const reads = inbox(1);
    const { pushKeyNow } = await import("../../apps/app/src/alerts/kept-push.ts");
    expect(await pushKeyNow()).toBeNull();
    expect(await pushKeyNow()).toBe("BPublicKey");
    expect(reads()).toBe(2);
  });
});
