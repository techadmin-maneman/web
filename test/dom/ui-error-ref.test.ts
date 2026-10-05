// A failed call's reference on the console's and the technician app's failure states (packages/ui/ErrorRef.tsx): the
// start of the API's request ID, which the person quotes, and a button that copies all of it.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorRef } from "../../packages/ui/ErrorRef.tsx";
import { Failed } from "../../packages/ui/States.tsx";

const REQUEST_ID = "0192a8e4-5b6c-7d8e-9f00-112233445566";
const WORDS = { label: "Ref", copy: "Copy", copied: "Copied" };

let page: HTMLElement;
let root: Root;

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  page.remove();
  Reflect.deleteProperty(navigator, "clipboard");
});

function failedWithRef(): void {
  const reference = createElement(ErrorRef, { requestId: REQUEST_ID, words: WORDS });
  act(() => {
    root.render(
      createElement(Failed, {
        message: "We could not load this.",
        retry: "Try again",
        onRetry: () => undefined,
        reference,
      }),
    );
  });
}

async function tapCopy(): Promise<void> {
  await act(async () => {
    page.querySelector<HTMLButtonElement>("button[type=button]")?.click();
    await Promise.resolve();
  });
}

describe("a failure's reference", () => {
  it("shows the start of the request ID under the failure's line", () => {
    failedWithRef();
    expect(page.querySelector("[role=alert]")?.textContent).toContain("We could not load this.Ref 0192a8e4Copy");
  });

  it("copies the whole request ID, and says so", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    failedWithRef();

    await tapCopy();
    expect(writeText).toHaveBeenCalledWith(REQUEST_ID);
    expect(page.textContent).toContain("Copied");
  });

  it("stays as it was where the page may not write to the clipboard", async () => {
    failedWithRef();
    await tapCopy();
    expect(page.textContent).toContain("Ref 0192a8e4Copy");
  });
});
