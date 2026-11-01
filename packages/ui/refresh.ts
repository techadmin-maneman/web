// A page read again in place, the frame and the address kept: App draws the page anew, and the frame says why above it.

import { createContext, useContext } from "react";

/** Reads the open page again, with a line for the frame to say above it. */
export const PageRefresh = createContext<(note: string) => void>(() => undefined);

export const useRefreshPage = () => useContext(PageRefresh);
