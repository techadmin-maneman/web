// The Words page's words (Growth; docs/decisions/0126-the-words-page.md). The page imports them itself, so they stay
// out of the console's first load.

import { changed, FAILED, NOT_PERMITTED, OFFLINE, UNCONFIRMED } from "./common.ts";

export const words = {
  title: "Words",
  narrow: "Find words",
  columns: { page: "Page", where: "Where", wording: "Wording" },
  /** The site's parts as the Where column names them; any other is its own name in words. */
  places: {
    header: "Header",
    stickyBar: "Bar at the foot",
    footer: "Footer",
    hero: "Top of the page",
    norwood: "Hair-loss scale",
    discretionBand: "Discretion",
    faq: "Questions",
    closing: "Last section",
    booking: "Booking form",
    notFound: "Page not found",
    pageTitles: "Page title",
    pageDescriptions: "Search result text",
    nav: "Menu link",
    cta: "Button",
    numberCode: "Number check",
    consentBar: "Cookie bar",
    islandFailed: "When a part fails to load",
  } as Readonly<Record<string, string | undefined>>,
  changed: (by: string, day: string) => `Changed by ${by}, ${day}`,
  /** A row's name, read as what pressing it does. */
  open: (where: string) => `Open ${where}`,
  form: {
    code: "In the code",
    wording: "Wording",
    keep: (holes: string) => `Keep ${holes}.`,
    longest: (count: number) => `Up to ${String(count)} characters.`,
    toCode: "Back to the code’s wording",
    atOnce: "Sends in these words from the next message.",
    afterApproval: "Changes go live once WhatsApp approves them.",
  },
  versions: {
    title: (where: string) => `History: ${where}`,
    none: "Never changed.",
    inCode: "The code’s wording",
    by: (by: string, day: string) => `${by}, ${day}`,
    use: "Use",
    useLabel: (day: string) => `Use the wording of ${day}`,
  },
  notOnSite: "Not on the site yet",
  /** The code's wording a copy review has not read: a line written or changed since the last one. */
  review: { notReviewed: "Not reviewed" },
  publish: {
    open: "Publish the site",
    title: "Publish the site’s words?",
    changed: (count: number) => `${String(count)} ${count === 1 ? "line" : "lines"} changed since the last publish.`,
    none: "Nothing changed since the last publish.",
    staging: "Live on staging within the hour.",
    production: "Live with the next release.",
    last: (day: string, by: string) => `Last published ${day} by ${by}.`,
    never: "Not published yet.",
    done: "Published.",
  },
  errors: {
    empty: "Write something, or go back to the code’s wording.",
    holes: "Keep every {…} the page fills, and add none.",
    price: "Take the price out: the site gives none.",
    visits: "No visit counts: what a referral earns is set in the console.",
    placeholder: "No placeholder text.",
    length: "Too long for where it sits.",
    first_line: "The first line shows on a locked phone. Keep hair systems, fittings and visits out of it.",
    ends_on_detail: "End on words, not a detail.",
    not_found: changed("Not found."),
    not_permitted: NOT_PERMITTED,
    offline: OFFLINE,
    unconfirmed: UNCONFIRMED,
    unknown: FAILED,
  },
};
