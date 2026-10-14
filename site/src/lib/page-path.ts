// A page's address as a visitor sees it: the build writes each page as a file, /try as try.html and / as index.html,
// and the address never shows the extension. The canonical link and the header's rules both read it.

export const pagePath = (pathname: string): string =>
  pathname.replace(/(index)?\.html$/, "").replace(/(.)\/$/, "$1");

/** The pages that are themselves the booking form, which offer no button to it. */
export const isBookingPage = (path: string): boolean => path === "/book" || path === "/r" || path.startsWith("/r/");
