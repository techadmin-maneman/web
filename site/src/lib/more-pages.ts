// The guides, once their wording is published, which both footers link. The cities' pages stay up but unlinked.

import { guides, guidesPage } from "../content/guides.ts";
import { isShown } from "./build.ts";

export const MORE_PAGES = [...(guides.some(isShown) ? [{ label: guidesPage.title, href: "/guides" }] : [])];
