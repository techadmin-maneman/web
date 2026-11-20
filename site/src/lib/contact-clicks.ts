// A chat or a call begun from any link on a page (docs/decisions/0288-attribution-and-conversions.md): each is
// reported to the analytics tags, and a chat with our number opens with the visitor's reference at the end of its
// words, "Hi, I'd like to know more. Ref M7K2Q9XP", so the chat that reaches Care carries where the visit came from. One
// listener for the page, so every link, the footer's and the forms' alike, is read the same way.

import { whatsappChat } from "@maneman/web-kit/whatsapp";
import { refLine } from "@rules/config/ref-tokens.ts";
import { whatsapp } from "../content/site/contact.ts";
import { track } from "./analytics.ts";
import { INVITE_PATH_IN_URL } from "./invite.ts";
import { visitorRef } from "./visit.ts";

/** A chat with a number, as wa.me writes it: a share link to whoever the sender picks is not one. */
const CHAT = /^https:\/\/wa\.me\/\d+/;

/** The link's words with the reference at their end, or the greeting with it where there are none. */
function withRef(link: HTMLAnchorElement, ref: string): void {
  const url = new URL(link.href);
  const words = url.searchParams.get("text");
  if (words?.includes(refLine(ref)) === true) return;
  link.href = whatsappChat(url.pathname, `${words ?? whatsapp.greeting} ${refLine(ref)}`);
}

/** The page's path as the tags are told it: an invite's code left out. */
const pagePath = (): string => location.pathname.replace(INVITE_PATH_IN_URL, "/r/");

export function watchContactLinks(): void {
  document.addEventListener(
    "click",
    (event) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement)) return;
      if (CHAT.test(link.href)) {
        const ref = visitorRef();
        if (ref !== null) withRef(link, ref);
        track({ name: "whatsapp_click", page_path: pagePath() });
      } else if (link.href.startsWith("tel:")) {
        track({ name: "call_click", page_path: pagePath() });
      }
    },
    { capture: true },
  );
}
