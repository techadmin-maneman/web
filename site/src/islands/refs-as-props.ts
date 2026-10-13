// Preact keeps a function component's `ref` to itself; React 19, which the shared parts (packages/ui) are written for,
// hands it over as a prop. This gives the islands React 19's way, so a ref given to a shared field reaches its input.
// An island that gives a shared part a ref imports this first; a module runs once, however many islands import it.

import { options, type ComponentType } from "preact";

/** A class component draws through its prototype's render; a function component has none. */
const isFunctionComponent = (type: ComponentType | string) =>
  typeof type === "function" && typeof (type.prototype as { render?: unknown } | undefined)?.render !== "function";

const before = options.vnode?.bind(options);
options.vnode = (vnode) => {
  if (isFunctionComponent(vnode.type) && vnode.ref !== undefined && vnode.ref !== null) {
    (vnode.props as { ref?: unknown }).ref = vnode.ref;
    vnode.ref = null;
  }
  before?.(vnode);
};
