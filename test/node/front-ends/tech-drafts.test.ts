// A step's draft on the phone (apps/tech/src/steps/drafts.ts): one of each kind, so letting go of one job's never
// takes another job's.

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { deviceRecord, put, wipe } from "../../../apps/tech/src/store/db.ts";
import { forgetDraft } from "../../../apps/tech/src/steps/drafts.ts";

afterEach(async () => {
  await wipe();
});

describe("a step's draft", () => {
  it("is let go for its own job", async () => {
    await put("device", { key: "options_draft", job_id: "visit-a", picked: "natural" });
    await forgetDraft("options_draft", "visit-a");
    expect(await deviceRecord("options_draft")).toBeNull();
  });

  it("is kept when another job lets go of its own", async () => {
    await put("device", { key: "options_draft", job_id: "visit-a", picked: "natural" });
    await forgetDraft("options_draft", "visit-b");
    expect(await deviceRecord("options_draft")).toMatchObject({ job_id: "visit-a", picked: "natural" });
  });
});
