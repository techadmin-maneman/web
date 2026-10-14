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
