// A guided task's words in the technician app (apps/tech/src/steps/TaskGuide.tsx): the numbered instructions and what
// to watch for, and no empty box where a reference photograph will go, which read as a photograph that failed to come.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskGuide } from "../../apps/tech/src/steps/TaskGuide.tsx";
import { taskFor } from "../../apps/tech/src/visit/index.ts";
import { visit } from "../../apps/tech/src/content.ts";

let page: HTMLDivElement;
let root: Root;

beforeEach(() => {
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

describe("a guided task", () => {
  it("says what to do and what to watch for, and draws no photograph it has none of", () => {
    const words = taskFor({ id: "base_trimmed", label: "Trim the base" });
    act(() => {
      root.render(createElement(TaskGuide, { words }));
    });
    expect([...page.querySelectorAll("ol li")].map((line) => line.textContent)).toEqual([...words.how]);
    expect(page.textContent).toContain(visit.watchFor);
    expect(page.querySelector("[role='img'], img")).toBeNull();
  });
});
