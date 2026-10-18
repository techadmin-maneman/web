// A value changed where it reads (packages/ui/EditableRow.tsx; docs/decisions/0212-editing-in-place.md): words until
// pressed, its box in place and focused once pressed, kept on Enter or Save and said saved beside it, put back on
// Escape or Cancel with nothing sent, a refusal said under the box with the box still open, and plain words with
// nothing to press for a person who may only look.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditableRow } from "../../packages/ui/EditableRow.tsx";

const WORDS = { change: "Change", save: "Save", cancel: "Cancel", saved: "Saved" };

let page: HTMLDivElement;
let root: Root;
let sent: string[];
let answer: string | null;

function show(mayChange = true) {
  act(() => {
    root.render(
      createElement(EditableRow<string>, {
        label: "Length",
        value: "90 min",
        words: WORDS,
        mayChange,
        start: () => "90",
        save: (typed: string) => {
          sent.push(typed);
          return Promise.resolve(answer);
        },
        children: (control, typed, type) =>
          createElement("input", {
            ...control,
            value: typed,
            onChange: (event: { target: { value: string } }) => {
              type(event.target.value);
            },
          }),
      }),
    );
  });
}

const valueButton = () => page.querySelector<HTMLButtonElement>('button[aria-label="Change Length"]');
const box = () => page.querySelector("input");
const buttonNamed = (text: string) =>
  [...page.querySelectorAll("button")].find((each) => each.textContent.trim() === text);

/** Types into the box as a person would, so React hears the change. */
function type(text: string) {
  const input = box();
  if (input === null) throw new Error("no box");
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit() {
  const form = page.querySelector("form");
  if (form === null) throw new Error("no form");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  sent = [];
  answer = null;
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

describe("a value changed where it reads", () => {
  it("reads as words, with its own button and no box until pressed", () => {
    show();
    expect(valueButton()?.textContent).toContain("90 min");
    expect(box()).toBeNull();
  });

  it("opens its box in place on a press, focused, holding the value as it stands", () => {
    show();
    act(() => valueButton()?.click());
    expect(box()?.value).toBe("90");
    expect(document.activeElement).toBe(box());
  });

  it("keeps the change on Enter, says it saved beside the value, and gives the value the keyboard back", async () => {
    show();
    act(() => valueButton()?.click());
    type("75");
    await submit();
    expect(sent).toEqual(["75"]);
    expect(box()).toBeNull();
    expect(page.querySelector('[role="status"]')?.textContent).toBe("Saved");
    expect(document.activeElement).toBe(valueButton());
  });

  it("puts the value back on Escape and on Cancel, and sends nothing", () => {
    show();
    act(() => valueButton()?.click());
    type("75");
    act(() => {
      page.querySelector("form")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(box()).toBeNull();
    act(() => valueButton()?.click());
    act(() => buttonNamed("Cancel")?.click());
    expect(box()).toBeNull();
    expect(sent).toEqual([]);
  });

  it("says a refusal under the box, marks the box, and keeps it open", async () => {
    answer = "Between 30 minutes and the length of a day.";
    show();
    act(() => valueButton()?.click());
    type("20");
    await submit();
    const refusal = page.querySelector('[role="alert"]');
    expect(refusal?.textContent).toBe(answer);
    expect(box()?.getAttribute("aria-invalid")).toBe("true");
    expect(box()?.getAttribute("aria-describedby")).toBe(refusal?.id);
  });

  it("is plain words with nothing to press for a person who may only look", () => {
    show(false);
    expect(page.textContent).toContain("Length");
    expect(page.textContent).toContain("90 min");
    expect(page.querySelector("button")).toBeNull();
  });
});
