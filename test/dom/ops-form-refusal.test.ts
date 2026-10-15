// A form's refusal (apps/ops/src/components/Refusal.tsx): said under the form, or at the box it names and told to a
// screen reader, and one that says what was acted on had changed reads the page again either way.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormRefusal } from "../../apps/ops/src/components/Refusal.tsx";
import { changed, LATEST } from "../../apps/ops/src/content/common.ts";
import { PageRefresh } from "../../apps/ops/src/lib/refresh.ts";

const ERRORS = { place_id: changed("Unknown place."), note: "Say what happened.", failed: "That didn’t save." };

let page: HTMLDivElement;
let root: Root;
let refresh: ReturnType<typeof vi.fn<(note: string) => void>>;

beforeEach(() => {
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
  refresh = vi.fn<(note: string) => void>();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  page.remove();
});

function draw(fields: readonly string[], boxes: readonly string[]) {
  const refusal = createElement(FormRefusal, {
    errors: ERRORS,
    failure: { code: "invalid_request", fields },
    boxes,
  });
  act(() => {
    root.render(createElement(PageRefresh.Provider, { value: refresh }, refusal));
  });
}

describe("a form's refusal", () => {
  it("is said under the form when no box drawn names it", () => {
    draw(["note"], ["place_id"]);
    expect(page.textContent).toBe("Say what happened.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("is told to a screen reader alone when its box says it", () => {
    draw(["note"], ["note"]);
    expect(page.querySelector("[role=alert]")?.textContent).toBe("Say what happened.");
  });

  it.each([
    ["at its box", ["place_id"]],
    ["under the form", []],
  ])("reads the page again when what it names had changed, said %s", (_, boxes) => {
    draw(["place_id"], boxes);
    expect(refresh).toHaveBeenCalledWith(`Unknown place. ${LATEST}`);
  });
});
