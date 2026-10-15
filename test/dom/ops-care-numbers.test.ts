// Customer Care · Care numbers in the console (apps/ops/src/care/CareNumbersScreen.tsx;
// docs/decisions/0144-care-numbers.md): the figures for a period, what chats were about, and each Care person's replies.
// Every address is made up.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CareNumbersScreen } from "../../apps/ops/src/care/CareNumbersScreen.tsx";
import { care } from "../../apps/ops/src/content/care.ts";
import { answered } from "./render-hook.ts";
import { contractChecked } from "./contract-fetch.ts";

const copy = care.numbers;

const NUMBERS = {
  from: "2026-09-14",
  to: "2026-09-21",
  replies: { chats: 12, median_minutes: 42, within_target: 0.75 },
  same_day: 0.5,
  backlog: { waiting_on_us: 3, overdue: 1, waiting_on_client: 2 },
  reasons: [{ reason: "fit_problem", chats: 4 }],
  remedies: [{ reason: "fit_problem", remedies: 2, visits: 3 }],
  by_person: [{ email: "asha@maneman.test", chats: 7, median_minutes: 35, within_target: 0.86 }],
};

let page: HTMLDivElement;
let root: Root;
let asked: string[];

beforeEach(() => {
  asked = [];
  vi.stubGlobal(
    "fetch",
    contractChecked("ops", (url: string) => {
      const address = new URL(url, "https://ops.maneman.test");
      asked.push(`${address.pathname}${address.search}`);
      if (address.pathname === "/api/care-numbers") return Promise.resolve(Response.json(NUMBERS));
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

describe("the Care numbers page", () => {
  it("shows the week’s figures, reasons, remedies and each Care person", async () => {
    await act(async () => {
      root.render(createElement(CareNumbersScreen));
      await answered();
    });
    expect(asked).toContain("/api/care-numbers?days=7");
    expect(page.textContent).toContain(copy.minutes(42));
    expect(page.textContent).toContain("75%");
    expect(page.textContent).toContain("50%");
    expect(page.textContent).toContain(copy.counted(care.reasons.fit_problem, 4));
    expect(page.textContent).toContain(copy.remedied(care.remedy.reasons.fit_problem, 2, 3));
    expect(page.textContent).toContain("asha@maneman.test");
    expect(page.textContent).toContain("86%");
  });

  it("asks for another period when one is chosen", async () => {
    await act(async () => {
      root.render(createElement(CareNumbersScreen));
      await answered();
    });
    const select = page.querySelector("select");
    await act(async () => {
      if (select !== null) {
        select.value = "30";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await answered();
    });
    expect(asked).toContain("/api/care-numbers?days=30");
  });
});
