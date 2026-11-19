// The rows chosen in a list (packages/ui/useRowSelection.ts): one by its box, a run with Shift, every row shown by the
// head's box, and a row no longer shown let go.

import { act } from "react";
import { describe, expect, it } from "vitest";
import { useRowSelection } from "../../packages/ui/useRowSelection.ts";
import { renderHook } from "./render-hook.ts";

const ROWS = ["a", "b", "c", "d"];
const chosen = (hook: { current: () => { selected: ReadonlySet<string> } }) => [...hook.current().selected].sort();

describe("the rows chosen in a list", () => {
  it("ticks one, then a run to it with Shift, and clears a run the same way", () => {
    const hook = renderHook(useRowSelection, ROWS);
    act(() => {
      hook.current().toggle("a", false);
    });
    act(() => {
      hook.current().toggle("c", true);
    });
    expect(chosen(hook)).toEqual(["a", "b", "c"]);
    act(() => {
      hook.current().toggle("b", true);
    });
    // From c, the last ticked, back to b: b is chosen, so the run is cleared.
    expect(chosen(hook)).toEqual(["a"]);
    hook.unmount();
  });

  it("takes every row shown by the head's box, then none, and keeps only rows still shown", () => {
    const hook = renderHook(useRowSelection, ROWS);
    act(() => {
      hook.current().toggleAll();
    });
    expect(hook.current().all).toBe(true);
    hook.rerender(["a", "b"]);
    expect(chosen(hook)).toEqual(["a", "b"]);
    act(() => {
      hook.current().toggleAll();
    });
    expect(chosen(hook)).toEqual([]);
    hook.unmount();
  });
});
