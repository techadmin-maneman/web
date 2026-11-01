// Whether the window is a phone's (MEDIA.phone, @maneman/brand/breakpoints): what the frame draws there alone, the tab
// bar, the city's chips and the search and account buttons, is not drawn at all on a desk, so nothing hidden there
// shares a name with what is shown.

import { MEDIA } from "@maneman/brand/breakpoints";
import { useSyncExternalStore } from "react";

const phone = (): MediaQueryList | null =>
  typeof window === "undefined" || typeof window.matchMedia !== "function" ? null : window.matchMedia(MEDIA.phone);

function subscribe(listener: () => void): () => void {
  const query = phone();
  query?.addEventListener("change", listener);
  return () => {
    query?.removeEventListener("change", listener);
  };
}

export const useIsPhone = (): boolean => useSyncExternalStore(subscribe, () => phone()?.matches ?? false);
