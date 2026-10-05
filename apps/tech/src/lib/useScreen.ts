// A screen tells the technician, and his screen reader, where he is: its name
// goes in the browser's title, and the focus goes to its heading when it opens,
// rather than being dropped on the page when the last screen went.

import { useCallback, useEffect, useRef } from "react";
import { focusIfLost } from "@maneman/ui/arrival";
import { titles } from "../content.ts";

/**
 * Names the screen in the title, and answers a ref for its heading, which takes the focus once, when it first draws,
 * unless the screen has put it in a field of its own.
 */
export function useScreen(name: string | null): (heading: HTMLHeadingElement | null) => void {
  useEffect(() => {
    document.title = name === null ? titles.app : titles.of(name);
    return () => {
      document.title = titles.app;
    };
  }, [name]);

  const focused = useRef(false);
  return useCallback((heading: HTMLHeadingElement | null) => {
    if (heading === null || focused.current) return;
    focused.current = true;
    focusIfLost(heading, { preventScroll: true });
  }, []);
}
