// Close chat where the chat's open report is about the hair system the client wears: it asks whether the hair system
// was at fault, starting at No, and sends why where Care say it was (apps/ops/src/care/Composer.tsx,
// docs/decisions/0272-why-a-hair-system-failed.md).

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloseChat } from "../../apps/ops/src/care/Composer.tsx";
import { care as copy } from "../../apps/ops/src/content/care.ts";
import { clients } from "../../apps/ops/src/content/clients.ts";
import { PIECES } from "../../e2e/ops/fixtures.ts";
import { answered } from "./render-hook.ts";
import { contractChecked } from "./contract-fetch.ts";
import { openDialogsAsJsdomCan } from "./dialogs.ts";
import { ARJUN } from "./ops-messages-fixtures.ts";

const CLIENT = ARJUN.person?.id ?? "";

let page: HTMLDivElement;
let root: Root;
let posted: unknown[];

beforeEach(() => {
  openDialogsAsJsdomCan();
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  posted = [];
  vi.stubGlobal(
    "fetch",
    contractChecked("ops", (url: string, init?: RequestInit) => {
      const { pathname } = new URL(url, "https://ops.maneman.test");
      if (pathname === `/api/clients/${CLIENT}/pieces`) return Response.json(PIECES);
      if (pathname === `/api/conversations/${ARJUN.id}/close` && typeof init?.body === "string") {
        posted.push(JSON.parse(init.body) as unknown);
        return Response.json({ conversation: ARJUN, items: [], close_reason: null, piece_report: null });
      }
      return undefined;
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

/** Close chat opened for a chat whose report is about the client's hair system, or about nothing of theirs. */
async function opened(pieceOf: string | null): Promise<void> {
  await act(async () => {
    root.render(
      createElement(CloseChat, {
        conversationId: ARJUN.id,
        suggested: "fit_problem",
        pieceOf,
        onThread: () => undefined,
      }),
    );
    await answered();
  });
  await act(async () => {
    [...page.querySelectorAll("button")].find((each) => each.textContent.trim() === copy.compose.closeChat)?.click();
    await answered();
  });
}

const fault = () =>
  [...document.body.querySelectorAll("label")].find((each) => each.textContent.trim() === clients.atFault.label);

async function closeIt(): Promise<void> {
  await act(async () => {
    [...document.body.querySelectorAll("dialog button")]
      .find((each) => each.textContent.trim() === copy.compose.closeChat)
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await answered();
  });
}

describe("closing a chat about the hair system the client wears", () => {
  it("asks whether it was at fault, starting at No, and sends why where Care say it was", async () => {
    await opened(CLIENT);
    const label = fault();
    expect(label).toBeDefined();
    const select = document.getElementById(label?.htmlFor ?? "") as HTMLSelectElement | null;
    expect(select?.value).toBe("");
    act(() => {
      if (select === null) return;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, "shedding");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await closeIt();
    expect(posted).toEqual([{ reason: "fit_problem", failure_reason: "shedding" }]);
  });

  it("asks nothing of a chat whose report is about nothing the client wears", async () => {
    await opened(null);
    expect(fault()).toBeUndefined();
    await closeIt();
    expect(posted).toEqual([{ reason: "fit_problem" }]);
  });
});
