// A fit guarantee claim's drawer on Tasks (apps/ops/src/tasks/TaskDetail.tsx; docs/decisions/0258-the-issue-log.md):
// its line, its way to the client's chat, and the photographs of its own reports alone, once Care ask for them. Every
// name and number is made up.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../../apps/ops/src/api.ts";
import { care } from "../../apps/ops/src/content/care.ts";
import { tasks } from "../../apps/ops/src/content.ts";
import { TaskDrawer } from "../../apps/ops/src/tasks/TaskDetail.tsx";
import { contractChecked } from "./contract-fetch.ts";
import { openDialogsAsJsdomCan } from "./dialogs.ts";
import { answered } from "./render-hook.ts";

const CHAT = "8c1d9f4b-5e6a-4b7c-9d8e-3f4a5b6c7d8e";
const EARLIER = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const CLAIMED = "c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f";
const AT = "2027-09-21T05:13:00.000Z";

const CLAIM: Task = {
  id: CLAIMED,
  person: { id: "11111111-1111-4111-8111-111111111111", name: "Arjun Mehta" },
  facts: {
    group: "fit_guarantee_claim",
    reference: "MM-ISS-0002",
    fitted_on: "2027-09-18",
    sign_off: "signed",
    conversation_id: CHAT,
    photos: 2,
    references: ["MM-ISS-0002"],
  },
  detail: "It does not sit right at the front.",
  since: "2027-09-21T05:12:00.000Z",
  due: "2027-09-23T05:12:00.000Z",
  owner: null,
};

/** One photograph on an earlier report about something else, and two on the claim's. */
const PHOTOS = [
  { report_id: EARLIER, reference: "MM-ISS-0001", n: 1, at: AT },
  { report_id: CLAIMED, reference: "MM-ISS-0002", n: 1, at: AT },
  { report_id: CLAIMED, reference: "MM-ISS-0002", n: 2, at: AT },
];

let page: HTMLDivElement;
let root: Root;
let asked: string[];

beforeEach(() => {
  openDialogsAsJsdomCan();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:photo", revokeObjectURL: () => undefined }));
  asked = [];
  vi.stubGlobal(
    "fetch",
    contractChecked("ops", (url: string) => {
      const address = new URL(url, "https://ops.maneman.test");
      asked.push(address.pathname);
      if (address.pathname === `/api/conversations/${CHAT}/report-photos`) {
        return Promise.resolve(Response.json({ photos: PHOTOS }));
      }
      if (address.pathname.startsWith(`/api/conversations/${CHAT}/report-photos/`)) {
        const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });
        return Promise.resolve(new Response(jpeg, { headers: { "Content-Type": "image/jpeg" } }));
      }
      return Promise.resolve(Response.json({ error: { code: "unavailable", request_id: "r-1" } }, { status: 503 }));
    }),
  );
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  page.remove();
  vi.unstubAllGlobals();
});

async function open() {
  act(() => {
    root.render(
      createElement(TaskDrawer, {
        group: "fit_guarantee_claim",
        task: CLAIM,
        subject: "Arjun Mehta",
        now: new Date("2027-09-22T05:00:00.000Z"),
        acting: {
          me: null,
          staff: [],
          mayOwn: false,
          closable: true,
          owner: null,
          onOwner: () => undefined,
          onClosed: () => undefined,
        },
        onDismiss: () => undefined,
      }),
    );
  });
  await answered();
  return document.body.querySelector("dialog");
}

describe("a fit guarantee claim's drawer", () => {
  it("reads the claim's line and leads to the client's chat", async () => {
    const drawer = await open();
    expect(drawer?.textContent).toContain("MM-ISS-0002 · fitted Sat 18 Sep · signed off · 2 photos");
    const way = [...(drawer?.querySelectorAll("a") ?? [])].find((link) =>
      link.textContent.includes(tasks.decide.fit_guarantee_claim ?? ""),
    );
    expect(way?.getAttribute("href")).toBe(`/messages#chat-${CHAT}`);
  });

  it("shows the photographs of the claim's own reports, once asked for", async () => {
    const drawer = await open();
    expect(asked.filter((path) => path.includes("/report-photos/"))).toEqual([]);
    const show = [...(drawer?.querySelectorAll("button") ?? [])].find((button) =>
      button.textContent.includes(care.reportPhotos.show(2)),
    );
    await act(async () => {
      show?.click();
      await answered();
    });
    expect([...(drawer?.querySelectorAll("img") ?? [])].map((image) => image.getAttribute("alt"))).toEqual([
      care.reportPhotos.alt("MM-ISS-0002", 1),
      care.reportPhotos.alt("MM-ISS-0002", 2),
    ]);
    expect(asked).not.toContain(`/api/conversations/${CHAT}/report-photos/${EARLIER}/1`);
  });
});
