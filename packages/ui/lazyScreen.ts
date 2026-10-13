// A part of a screen loaded when it is first drawn, through loadOrReload: a page left open across a release asks for a
// file that release removed, and loads again on the new one instead of failing.

import { loadOrReload } from "@maneman/web-kit/load-or-reload";
import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/** `load` imports the module and picks the component: `() => import("./Totals.tsx").then((module) => module.Totals)`. */
export function lazyScreen<Props extends object>(
  load: () => Promise<ComponentType<Props>>,
): LazyExoticComponent<ComponentType<Props>> {
  return lazy(async () => ({ default: await loadOrReload(load) }));
}
