// The job card's word to the client (apps/tech/src/job/TellClient.tsx; docs/decisions/0145-technician-presets.md):
// on the way, running late or at the gate, queued in the outbox; a client without WhatsApp is called instead.
// Every name and number is made up.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../../apps/tech/src/api.ts";
import { job as copy } from "../../apps/tech/src/content.ts";
import { answered } from "./render-hook.ts";

const queued: { kind: string; jobId: string; body: unknown }[] = [];

vi.mock("../../apps/tech/src/store/outbox.ts", () => ({
  queue: (kind: string, jobId: string, body: unknown) => {
    queued.push({ kind, jobId, body });
    return Promise.resolve({});
  },
  replay: () => Promise.resolve({}),
}));

const { TellClient } = await import("../../apps/tech/src/job/TellClient.tsx");

const JOB = {
  id: "22222222-2222-4222-8222-222222222221",
  client: { name: "Rohit Malhotra", mobile: "+919810000001", note: null, whatsapp: true },
  progress: { checked_in_at: null, started_at: null, outcome: null },
} as unknown as Job;

let page: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  queued.length = 0;
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

const draw = (job: Job) => {
  act(() => {
    root.render(createElement(TellClient, { job }));
  });
};

const press = async (label: string) => {
  await act(async () => {
    [...page.querySelectorAll("button")].find((each) => each.textContent.trim() === label)?.click();
    await answered();
  });
};

describe("telling the client from the card", () => {
  it("queues on the way with the minutes chosen, and at the gate with none", async () => {
    draw(JOB);
    await press(copy.tell.minute(30));
    await press(copy.tell.onTheWay(30));
    await press(copy.tell.atGate);
    expect(queued).toEqual([
      { kind: "update", jobId: JOB.id, body: { preset: "on_the_way", minutes: 30 } },
      { kind: "update", jobId: JOB.id, body: { preset: "at_gate", minutes: null } },
    ]);
    expect(page.textContent).toContain(copy.tell.sent("Rohit"));
  });

  it("offers only At the gate once they have checked in, so the wait stays in view", () => {
    draw({ ...JOB, progress: { ...JOB.progress, checked_in_at: "2030-07-01T05:00:00.000Z" } });
    const labels = [...page.querySelectorAll("button")].map((each) => each.textContent.trim());
    expect(labels).toEqual([copy.tell.atGate]);
  });

  it("asks for a call where the client takes no WhatsApp messages about visits", () => {
    draw({ ...JOB, client: { ...JOB.client, whatsapp: false } } as Job);
    expect(page.textContent).toContain(copy.tell.noWhatsApp("Rohit"));
    expect(page.querySelectorAll("button")).toHaveLength(0);
  });
});
