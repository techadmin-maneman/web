// The texts of the WhatsApp messages we send, by template name. WA_RESULT_TEMPLATE
// picks one. Evolution has no Meta-approved templates, so the text lives here;
// an official BSP would hold its own copy.
//
// PLACEHOLDER COPY, pending the owner's wording. The second sentence is the
// design's own ("a simulation, not a photograph of a result").
//
// {{1}}, {{2}}, … are the params, in order, as in WhatsApp templates.

const TEMPLATES: Readonly<Record<string, string>> = {
  tryon_result_v1:
    "Hello {{1}}, here is your Mane Man try-on. What you see is a simulation, not a photograph of a result.",
};

/** The text with its params filled in, or null for an unknown template or a missing param. */
export function renderMessage(name: string, params: readonly string[]): string | null {
  const template = TEMPLATES[name];
  if (template === undefined) return null;

  const positions = [...template.matchAll(PLACEHOLDER)].map((match) => Number(match[1]));
  if (positions.some((position) => params[position - 1] === undefined)) return null;
  return template.replace(PLACEHOLDER, (_match, position: string) => params[Number(position) - 1] ?? "");
}

const PLACEHOLDER = /\{\{(\d+)\}\}/g;

export function isKnownTemplate(name: string): boolean {
  return name in TEMPLATES;
}
