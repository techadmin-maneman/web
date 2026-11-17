// A consultation and fit in one visit, its client declining at the piece step: the checklist that opens is the
// consultation's alone, and stays so while it is open, though the piece step then leaves the phone before the card is
// read again (apps/tech/src/steps/Checklist.tsx; docs/decisions/0271-the-technician-follow-ups.md).

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../../apps/tech/src/api.ts";
import { steps as copy, visit } from "../../apps/tech/src/content.ts";
import type { Queued } from "../../apps/tech/src/store/outbox.ts";

const JOB_ID = "22222222-2222-4222-8222-222222222221";
const item = (id: string) => ({ id, label: id });

/** The card as the phone holds it before the API has heard the client's choice. */
const CARD = {
  id: JOB_ID,
  type: "first_fit",
  one_visit: true,
  client_choice: null,
  client_alerts: [],
  steps: ["before_photos", "piece", "checklist"],
  checklist: ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map(item),
  checklist_if_declined: ["scalp_checked", "measurements_taken", "options_shown"].map(item),
} as unknown as Job;

/** The piece step on the phone, the client deciding against the fit. */
const DECLINED: Queued = {
  seq: 1,
  id: "01000000-0000-7000-8000-000000000001",
  job_id: JOB_ID,
  kind: "piece",
  body: { declined: true },
  state: "waiting",
} as unknown as Queued;

const standing: { queued: Queued[] } = { queued: [DECLINED] };

vi.mock("../../apps/tech/src/steps/useStep.ts", () => ({
  useStep: () => ({
    loaded: { state: "loaded", value: CARD },
    retry: () => undefined,
    refused: null,
    sentBack: null,
    queued: standing.queued,
    finish: () => Promise.resolve(),
    closeWith: () => Promise.resolve(),
    back: () => undefined,
  }),
}));
vi.mock("../../apps/tech/src/steps/drafts.ts", () => ({ useDraft: () => ({ read: true, draft: null }) }));
vi.mock("../../apps/tech/src/store/db.ts", () => ({
  put: () => Promise.resolve(),
  remove: () => Promise.resolve(),
}));
vi.mock("../../apps/tech/src/steps/StepFrame.tsx", async () => {
  const { createElement: draw } = await import("react");
  return {
    StepFrame: ({ title, children }: { title: string; children: ReactNode }) =>
      draw("main", null, draw("h1", null, title), children),
  };
});
vi.mock("../../apps/tech/src/steps/TaskGuide.tsx", () => ({ TaskGuide: () => null }));

const { Checklist } = await import("../../apps/tech/src/steps/Checklist.tsx");

let page: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  standing.queued = [DECLINED];
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  page.remove();
});

const draw = () => {
  act(() => {
    root.render(createElement(Checklist, { id: JOB_ID }));
  });
};

describe("a declined one visit's checklist", () => {
  it("opens as the consultation's, and stays so when the piece step leaves the phone before the card knows", () => {
    draw();
    expect(page.querySelector("h1")?.textContent).toBe(copy.checklistTitles.consultation);
    expect(page.textContent).toContain(visit.task(1, 3));

    // The piece step landed and left the outbox; the card in hand has not been read again.
    standing.queued = [];
    draw();
    expect(page.querySelector("h1")?.textContent).toBe(copy.checklistTitles.consultation);
    expect(page.textContent).toContain(visit.task(1, 3));
    expect(page.textContent).not.toContain(visit.task(1, 9));
  });
});
