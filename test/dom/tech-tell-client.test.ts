// The job card's word to the client (apps/tech/src/job/TellClient.tsx; docs/decisions/0145-technician-presets.md):
// on the way or running late, queued in the outbox, each word once; a client without WhatsApp is called instead.
// Every name and number is made up.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../../apps/tech/src/api.ts";
import { job as copy } from "../../apps/tech/src/content.ts";
import { openDialogsAsJsdomCan } from "./dialogs.ts";
import { answered } from "./render-hook.ts";

openDialogsAsJsdomCan();

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

/** The words in the sheet the card's button opens; the sheet is a dialog drawn into the body. */
const pressInSheet = async (label: string) => {
  await act(async () => {
    [...document.querySelectorAll<HTMLButtonElement>("dialog button")].find((each) => each.textContent.trim() === label)?.click();
    await answered();
  });
};

describe("telling the client from the card", () => {
  it("queues on the way with the minutes chosen, once: a second tap of the same word sends nothing", async () => {
    draw(JOB);
    await press(copy.tell.open("Rohit"));
    await pressInSheet(copy.tell.minute(30));
    await pressInSheet(copy.tell.onTheWay(30));
    expect(queued).toEqual([{ kind: "update", jobId: JOB.id, body: { preset: "on_the_way", minutes: 30 } }]);
    expect(page.textContent).toContain("Rohit updated at");

    await press(copy.tell.open("Rohit"));
    const onTheWay = [...document.querySelectorAll<HTMLButtonElement>("dialog button")].find((each) =>
      each.textContent.trim().startsWith("Sent at"),
    );
    expect(onTheWay?.hasAttribute("disabled")).toBe(true);
  });

  it("goes once they have checked in: the client hears of the arrival on their own", () => {
    draw({ ...JOB, progress: { ...JOB.progress, checked_in_at: "2030-07-01T05:00:00.000Z" } });
    expect(page.querySelectorAll("button")).toHaveLength(0);
  });

  it("asks for a call where the client takes no WhatsApp messages about visits", () => {
    draw({ ...JOB, client: { ...JOB.client, whatsapp: false } } as Job);
    expect(page.textContent).toContain(copy.tell.noWhatsApp("Rohit"));
    expect(page.querySelectorAll("button")).toHaveLength(0);
  });
});
