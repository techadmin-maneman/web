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
  // The client app's login code (docs/decisions/0030-one-time-codes.md). PLACEHOLDER COPY, pending the owner's wording.
  login_code_v1: "{{1}} is your Mane Man code. It works for ten minutes. We will never ask you for it.",
  // About a client's visits (docs/decisions/0047-visit-messages.md), sent only with the client's consent to
  // WhatsApp about visits. PLACEHOLDER COPY, pending the owner's wording (docs/open-points.md, item 40). Every one
  // takes the same params, and uses those it needs: {{1}} the client's first name, {{2}} the visit ("service
  // visit"), {{3}} its day ("Thu 24 Sep"), {{4}} its window ("12 to 4 pm"), {{5}} the technician's first name,
  // {{6}} the amount ("Rs. 2,000"), {{7}} the payment's reference, {{8}} where a refund goes ("UPI").
  consultation_booked_v1: "Hello {{1}}, your free consultation is booked for {{3}}, {{4}}. We will see you then.",
  visit_booked_v1:
    "Hello {{1}}, your {{2}} is booked for {{3}}, {{4}}, with {{5}}. Paid {{6}}, reference {{7}}. The receipt is in the app.",
  visit_reminder_v1: "Hello {{1}}, a reminder that your {{2}} is tomorrow, {{3}}, {{4}}, with {{5}}.",
  visit_moved_v1: "Hello {{1}}, your {{2}} is now on {{3}}, {{4}}, with {{5}}.",
  visit_cancelled_v1: "Hello {{1}}, your {{2}} on {{3}} is cancelled.",
  visit_cancelled_refund_v1:
    "Hello {{1}}, your {{2}} on {{3}} is cancelled. {{6}} is on its way back to your {{8}}, in 5 to 7 working days.",
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
