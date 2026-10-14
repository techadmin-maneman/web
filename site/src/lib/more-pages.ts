// The guides and the cities, once their wording is published, which both footers link.

import { areasPage, guides, guidesPage } from "../content/guides.ts";
import { isShown } from "./build.ts";

export const MORE_PAGES = [
  ...(guides.some(isShown) ? [{ label: guidesPage.title, href: "/guides" }] : []),
  ...(isShown(areasPage) ? [{ label: areasPage.title, href: "/areas" }] : []),
];
