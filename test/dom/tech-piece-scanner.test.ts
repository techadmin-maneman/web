// The hair system step's scanner (apps/tech/src/steps/PieceScan.tsx; docs/decisions/0271-the-technician-follow-ups.md):
// a label read goes in and the camera opens afresh for the next; the label in hand, held up again, is read past; and a
// code that is no label opens its box with what is wrong. The camera is a stand-in that reads what the test holds up.

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { steps as copy } from "../../apps/tech/src/content.ts";

interface CameraProps {
  readonly onRead: (text: string) => void;
  readonly takes?: (text: string) => boolean;
}

/** How many times the camera opened, and the one open now. */
const camera: { opened: number; open: CameraProps | null; stopped: boolean } = {
  opened: 0,
  open: null,
  stopped: false,
};

vi.mock("@maneman/ui/ScanField", async () => {
  const { useEffect } = await import("react");
  return {
    QrCamera: (props: CameraProps) => {
      useEffect(() => {
        camera.opened += 1;
        camera.stopped = false;
      }, []);
      camera.open = props;
      return null;
    },
  };
});

const { Scanner } = await import("../../apps/tech/src/steps/PieceScan.tsx");
const { NOT_LOOKED } = await import("../../apps/tech/src/steps/PieceFields.tsx");

/** A code held up to the camera: read, unless the camera has stopped after taking one or does not take it. */
function holdUp(text: string): void {
  const open = camera.open;
  if (open === null || camera.stopped) return;
  if (!(open.takes?.(text) ?? true)) return;
  camera.stopped = true;
  act(() => {
    open.onRead(text);
  });
}

const codes: string[] = [];

/** What the label's check found, as the step would say, and whether the kit holds a hair system to pick instead. */
const check: { looked: Parameters<typeof Scanner>[0]["looked"]; kitToPick: boolean } = {
  looked: NOT_LOOKED,
  kitToPick: true,
};

function Step() {
  const [code, setCode] = useState("");
  return createElement(Scanner, {
    code,
    looked: check.looked,
    looking: false,
    warning: null,
    cannotFit: null,
    onCode: (next: string) => {
      codes.push(next);
      setCode(next);
    },
    onLook: () => undefined,
    onNoLabel: check.kitToPick
      ? () => {
          noLabels.push(true);
        }
      : undefined,
  });
}

/** Each time the piece was said to have no label. */
const noLabels: boolean[] = [];

let page: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  camera.opened = 0;
  camera.open = null;
  camera.stopped = false;
  codes.length = 0;
  noLabels.length = 0;
  check.looked = NOT_LOOKED;
  check.kitToPick = true;
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
  act(() => {
    root.render(createElement(Step));
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  page.remove();
});

describe("the hair system step's scanner", () => {
  it("takes a label read and opens the camera afresh for the next", () => {
    expect(camera.opened).toBe(1);
    holdUp("mm-ess-0000001-a");
    expect(codes).toEqual(["MM-ESS-0000001-A"]);
    expect(camera.opened).toBe(2);
  });

  it("reads past the label in hand held up again, checking it once, and takes the next one", () => {
    holdUp("MM-ESS-0000001-A");
    holdUp("MM-ESS-0000001-A");
    holdUp("MM-ESS-0000001-A");
    expect(codes).toEqual(["MM-ESS-0000001-A"]);
    expect(camera.opened).toBe(2);
    holdUp("MM-ESS-0000002-B");
    expect(codes).toEqual(["MM-ESS-0000001-A", "MM-ESS-0000002-B"]);
  });

  it("opens the code's box with what is wrong for a code that is no label", () => {
    holdUp("https://example.com/not-a-label");
    const box = page.querySelector("input");
    expect(box).not.toBeNull();
    expect(page.textContent).toContain(copy.piece.malformed);
  });

  // A label lost or never stuck on never stops the fit.
  it("offers No label on it beside typing the code, for a piece with none to read", () => {
    const noLabel = [...page.querySelectorAll("button")].find((each) => each.textContent.trim() === copy.piece.noLabel);
    expect(noLabel).toBeDefined();
    act(() => {
      noLabel?.click();
    });
    expect(noLabels).toEqual([true]);
  });

  it("offers no No label on it where the kit holds no hair system to pick in its place", () => {
    check.kitToPick = false;
    act(() => {
      root.render(createElement(Step));
    });
    const texts = [...page.querySelectorAll("button")].map((each) => each.textContent.trim());
    expect(texts).toContain(copy.piece.typeCode);
    expect(texts).not.toContain(copy.piece.noLabel);
  });

  it("offers Check again under the scanner for a label read with no signal, its code box left shut", () => {
    holdUp("MM-ESS-0000001-A");
    check.looked = { state: "offline" };
    act(() => {
      root.render(createElement(Step));
    });
    const buttons = [...page.querySelectorAll("button")].map((each) => each.textContent.trim());
    expect(buttons).toContain(copy.piece.checkAgain);
    expect(page.querySelector("input")).toBeNull();
  });
});
