// The guides, once their wording is published, which the footer links beside the cities (../components/Footer.astro).

import { guides, guidesPage } from "../content/guides.ts";
import { isShown } from "./build.ts";

export const MORE_PAGES = [...(guides.some(isShown) ? [{ label: guidesPage.title, href: "/guides" }] : [])];
