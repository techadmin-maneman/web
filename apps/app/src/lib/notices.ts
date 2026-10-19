// The site's full notices, which each consent's one line links to, for the environment the app was built for.

import type { NoticeSection } from "@rules/config/notices.ts";
import { NOTICES_URL } from "../content.ts";

/** A section of the site's /notices page: "photos", "whatsapp" or "try-on". */
export const noticeUrl = (section: NoticeSection): string => `${NOTICES_URL[import.meta.env.MM_ENV]}#${section}`;
