// A hook run in a component of its own on a real page (jsdom), as the screens run it, so its effects and state behave
// as they do in the apps. What it answers on its latest render is read through `current`.

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

export interface Rendered<T> {
  /** What the hook answered on its latest render. */
  readonly current: () => T;
  /** Renders it again with new props. */
  readonly rerender: (props?: unknown) => void;
  readonly unmount: () => void;
}

export function renderHook<T, P = undefined>(hook: (props: P) => T, props?: P): Rendered<T> {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const page = document.createElement("div");
  document.body.append(page);
  const root = createRoot(page);
  let latest: { value: T } | null = null;
  function Probe({ given }: { given: P }) {
    latest = { value: hook(given) };
    return null;
  }
  const render = (given: P) => {
    act(() => {
      root.render(createElement(Probe, { given }));
    });
  };
  render(props as P);
  return {
    current: () => {
      if (latest === null) throw new Error("the hook has not rendered");
      return latest.value;
    },
    rerender: (next) => {
      render(next as P);
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
      page.remove();
    },
  };
}

/** Lets the promises the hook started settle, and their state reach the page. */
export async function settled(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}
