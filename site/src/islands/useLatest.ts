// The newest of a value an island draws anew each render, such as a callback, for an effect that must call the newest
// without starting again whenever it changes: what React's useEffectEvent does in the apps, which Preact lacks.

import { useLayoutEffect, useRef } from "preact/hooks";

export function useLatest<T>(value: T): { readonly current: T } {
  const latest = useRef(value);
  useLayoutEffect(() => {
    latest.current = value;
  });
  return latest;
}
