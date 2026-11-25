// A page's address as a visitor sees it: the build writes each page as a file, /try as try.html and / as index.html,
// and the address never shows the extension. The canonical link and the header's rules both read it.

export const pagePath = (pathname: string): string => pathname.replace(/(index)?\.html$/, "").replace(/(.)\/$/, "$1");

/** The pages that are themselves the booking form, which offer no button to it. */
export const isBookingPage = (path: string): boolean => path === "/book" || path === "/r" || path.startsWith("/r/");

/** The booking and the try-on, flows of their own: on a laptop, the flow's bar for a header and no footer (ADR 0265). */
export const isFlowPage = (path: string): boolean => isBookingPage(path) || path === "/try";

/**
 * A link to one of the home page's sections ("/#faq"), kept on the page where the page has that section of its own,
 * as the Gurgaon page has the questions: "#faq" there, "/#faq" on every other.
 */
export const sectionHref = (href: string, sections: readonly string[]): string =>
  href.startsWith("/#") && sections.includes(href.slice(2)) ? href.slice(1) : href;
