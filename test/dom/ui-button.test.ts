// A busy button (packages/ui/Button.tsx) does nothing on a second tap: it neither acts again nor, as a submit
// button, sends its form again. In the console a button that names an icon draws it alone, its words still its name
// (docs/decisions/0316-every-console-action-an-icon.md).

import { act, createElement, type SyntheticEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ACTION_ICONS } from "../../packages/brand/action-icons.ts";
import { Button } from "../../packages/ui/Button.tsx";
import { IconActions } from "../../packages/ui/icon-actions.ts";
import { TextButton } from "../../packages/ui/TextLink.tsx";
import { VisuallyHidden } from "../../packages/ui/VisuallyHidden.tsx";

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
});

function tap(): void {
  act(() => {
    page.querySelector("button")?.click();
  });
}

/** A form with one submit button, and how many times it has been sent. */
function form(busy: boolean): { sent: () => number } {
  let sent = 0;
  const send = (event: SyntheticEvent) => {
    event.preventDefault();
    sent += 1;
  };
  act(() => {
    root.render(
      createElement(
        "form",
        { onSubmit: send },
        createElement(Button, { variant: "primary", size: "action", type: "submit", busy }, "Send"),
      ),
    );
  });
  return { sent: () => sent };
}

/** A button that counts its taps. */
function counting(busy: boolean): { taps: () => number } {
  let taps = 0;
  const onClick = () => {
    taps += 1;
  };
  act(() => {
    root.render(createElement(Button, { variant: "primary", size: "action", busy, onClick }, "Pay"));
  });
  return { taps: () => taps };
}

describe("a busy button", () => {
  it("does not send its form again", () => {
    const { sent } = form(true);
    tap();
    expect(sent()).toBe(0);
  });

  it("does not act on a second tap", () => {
    const { taps } = counting(true);
    tap();
    expect(taps()).toBe(0);
  });
});

describe("a button that is not busy", () => {
  it("sends its form", () => {
    const { sent } = form(false);
    tap();
    expect(sent()).toBe(1);
  });

  it("acts on a tap", () => {
    const { taps } = counting(false);
    tap();
    expect(taps()).toBe(1);
  });
});

/** A button that names an icon, in the console or out of it. */
function drawn(inConsole: boolean, button: ReturnType<typeof createElement>): HTMLButtonElement {
  act(() => {
    root.render(createElement(IconActions.Provider, { value: inConsole }, button));
  });
  const found = page.querySelector("button");
  if (found === null) throw new Error("no button drawn");
  return found;
}

/** The words drawn in the button's own line, as against those inside its icon or its hidden name. */
const seen = (button: HTMLButtonElement) =>
  [...button.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent)
    .join("");

describe("a button that names an icon", () => {
  const save = createElement(Button, { variant: "primary", size: "small", icon: ACTION_ICONS.check }, "Save");

  it("in the console draws its icon alone, its words its name and its hover label", () => {
    const button = drawn(true, save);
    expect(button.querySelector("svg")).not.toBeNull();
    expect(seen(button)).toBe("");
    expect(button.textContent).toBe("Save");
    expect(button.dataset.tip).toBe("Save");
  });

  it("elsewhere keeps its words beside its icon, with no hover label", () => {
    const button = drawn(false, save);
    expect(seen(button)).toBe("Save");
    expect(button.dataset.tip).toBeUndefined();
  });

  it("takes its aria-label for its hover label, where that names what it acts on", () => {
    const remove = createElement(
      Button,
      { variant: "outline", size: "small", icon: ACTION_ICONS.trash, "aria-label": "Remove the 12 Nov visit" },
      "Remove",
    );
    expect(drawn(true, remove).dataset.tip).toBe("Remove the 12 Nov visit");
  });

  it("shows on hover only the words a person would have seen, not those for a screen reader", () => {
    const take = createElement(
      Button,
      { variant: "outline", size: "small", icon: ACTION_ICONS.handGrab },
      "Take",
      createElement(VisuallyHidden, null, " · a call to make"),
    );
    const button = drawn(true, take);
    expect(button.dataset.tip).toBe("Take");
    expect(button.textContent).toBe("Take · a call to make");
  });

  it("that cannot act yet stays reachable in the console, said unavailable, and does nothing on a tap", () => {
    let taps = 0;
    const waiting = createElement(
      Button,
      { variant: "primary", size: "small", icon: ACTION_ICONS.check, disabled: true, onClick: () => (taps += 1) },
      "Save",
    );
    const button = drawn(true, waiting);
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    act(() => {
      button.click();
    });
    expect(taps).toBe(0);
    expect(drawn(false, waiting).disabled).toBe(true);
  });

  it("as a text button, does the same", () => {
    const more = createElement(TextButton, { icon: ACTION_ICONS.chevronDown }, "Show 4 more");
    const button = drawn(true, more);
    expect(button.querySelector("svg")).not.toBeNull();
    expect(button.dataset.tip).toBe("Show 4 more");
  });
});
