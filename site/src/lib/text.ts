// Fills the {name} holes in a content string: fill("not yet in {city}", { city: "Pune" }); and finds the {whatsapp}
// hole a page draws as a link instead.

export function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (hole, key: string) => values[key] ?? hole);
}

/** "{whatsapp}" in a sentence is the business number, which the page draws as a link to a WhatsApp chat. */
const WHATSAPP_HOLE = "{whatsapp}";

/** The sentence's text around its WhatsApp holes: the page draws the link between each part and the next. */
export function aroundWhatsapp(sentence: string): readonly string[] {
  return sentence.split(WHATSAPP_HOLE);
}

/** A run of plain text, or a link the sentence names: an address at maneman.in, an email there, or a phone number. */
export type TextPart = { readonly text: string } | { readonly text: string; readonly href: string };

const LINKED = /(https:\/\/[a-z0-9.-]*maneman\.in(?:\/[a-z0-9/_-]*)?|[a-z0-9._-]+@maneman\.in|\+91 \d{5} \d{5})/g;

/** A page of ours is linked by its path, so a page read on staging stays on staging. */
function hrefOf(linked: string): string {
  if (linked.includes("@")) return `mailto:${linked}`;
  if (linked.startsWith("+")) return `tel:${linked.replaceAll(" ", "")}`;
  const url = new URL(linked);
  return url.host === "maneman.in" ? url.pathname : linked;
}

/** The sentence in parts, each address, email and phone number it names a link. */
export function withLinks(sentence: string): readonly TextPart[] {
  return sentence
    .split(LINKED)
    .filter((part) => part !== "")
    .map((part) => (new RegExp(`^${LINKED.source}$`).test(part) ? { text: part, href: hrefOf(part) } : { text: part }));
}
