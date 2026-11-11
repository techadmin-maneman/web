// The technician's asks of ops on the phone (docs/decisions/0249-schedule-kit-and-me.md): when an ask was made, today's
// time or an earlier day's date and time; and the job's line follows the card, open while the ask is, gone once ops
// settle it.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../../apps/tech/src/api.ts";
import { reschedule as copy } from "../../apps/tech/src/content.ts";
import { stamp } from "../../apps/tech/src/lib/when.ts";

const { Reschedule } = await import("../../apps/tech/src/job/Reschedule.tsx");

describe("when an ask was made", () => {
  const now = new Date("2026-11-12T06:30:00.000Z");

  it("says today's time alone", () => {
    expect(stamp("2026-11-12T03:35:00.000Z", now)).toBe("9:05 am");
  });

  it("says an earlier day's date beside the time", () => {
    expect(stamp("2026-11-10T03:35:00.000Z", now)).toBe("10 Nov, 9:05 am");
  });
});

describe("the ask to reschedule on the job", () => {
  let host: HTMLElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.unstubAllGlobals();
  });

  const job = (asked: Job["reschedule_asked"]) =>
    ({ id: "job-1", progress: { outcome: null }, reschedule_asked: asked }) as unknown as Job;

  const draw = (asked: Job["reschedule_asked"]) => {
    act(() => {
      root.render(createElement(Reschedule, { job: job(asked) }));
    });
  };

  it("says the ask stands while the card does, and offers it again once ops settle it", () => {
    draw({ asked_at: new Date().toISOString(), reason: "client_asked" });
    expect(host.querySelector('[role="status"]')?.textContent).toContain(copy.reasons.client_asked);
    expect(host.textContent).not.toContain(copy.open);

    // The card read again: ops have settled it.
    draw(null);
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(host.textContent).toContain(copy.open);
  });
});
