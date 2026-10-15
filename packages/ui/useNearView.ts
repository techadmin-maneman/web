import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Whether the element has come within `margin` of the screen, as a long list scrolls: true from then on, so what was
 * drawn stays drawn. A browser without IntersectionObserver, and a test's page, take everything as in view.
 */
export function useNearView<T extends Element>(margin = "800px"): [RefObject<T | null>, boolean] {
  const element = useRef<T>(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const target = element.current;
    if (near || target === null) return;
    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: margin },
    );
    watch.observe(target);
    return () => {
      watch.disconnect();
    };
  }, [near, margin]);
  return [element, near];
}
