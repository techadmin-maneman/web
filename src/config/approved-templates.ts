// Our WhatsApp texts as the WhatsApp Business Platform approves them. An approved template numbers its variables
// {{1}}, {{2}}, … in the order they first appear and uses each, where ours share one numbering across every visit
// message ("{{5}} is at your door for your {{2}}"). So each is renumbered here, and a send maps our params onto it.
// A link a text ends with becomes a button, since a template may not end on a variable.

import { TEMPLATES, type TemplateName } from "./message-templates.ts";

/** How WhatsApp prices and polices a template: a login code, or a message about something the person has. */
export type TemplateCategory = "authentication" | "utility";

/**
 * A button under the text. Its address is our site's origin and a suffix each message gives: the path of one of our
 * params (a link to book), or of the message's stop link. A login code's copies the code.
 */
export type ApprovedButton =
  | { readonly kind: "link"; readonly label: string; readonly param: number }
  | { readonly kind: "stop"; readonly label: string }
  | { readonly kind: "copy_code" };

export interface ApprovedTemplate {
  readonly name: TemplateName;
  readonly category: TemplateCategory;
  /** The body as it is submitted, its variables renumbered from 1. Empty for a login code, whose words WhatsApp sets. */
  readonly body: string;
  /** For each of the body's variables in turn, the position of our param it takes: [1, 5, 2] puts {{5}} second. */
  readonly takes: readonly number[];
  /** An image above the body: the try-on's look. */
  readonly imageHeader: boolean;
  readonly buttons: readonly ApprovedButton[];
}

const STOP: ApprovedButton = { kind: "stop", label: "Stop these messages" };

/**
 * Where the approved form differs from the text the bridge sends: a closing link turned into a button, and the stop
 * line, which the bridge appends, as a button on the templates sent with one (STOP_LINKS).
 */
const DIFFERS: Partial<Record<TemplateName, { readonly text?: string; readonly buttons: readonly ApprovedButton[] }>> =
  {
    tryon_result_v1: {
      text: "Hi {{1}}, here's your new look from Mane Man. It's a simulation: your real hair system is matched to your own hair. See it for real at a free consultation.",
      buttons: [{ kind: "link", label: "Book a consultation", param: 2 }],
    },
    launch_alert_v1: {
      text: "Hi {{1}}, Mane Man now comes to {{2}}. Book your free consultation below.",
      buttons: [{ kind: "link", label: "Book a consultation", param: 3 }, STOP],
    },
    visit_reminder_v1: { buttons: [STOP] },
    next_visit_due_v1: { buttons: [STOP] },
    credits_expiring_v1: { buttons: [STOP] },
  };

/** Never submitted: the stop line is a button, and the answer to STOP goes as a reply while the chat is open. */
const NOT_SUBMITTED: ReadonlySet<TemplateName> = new Set(["stop_link_v1", "messages_stopped_v1"]);

const PARAM = /\{\{(\d+)\}\}/g;

/** Our param positions in the order the text first uses each. */
function positionsIn(text: string): number[] {
  const seen: number[] = [];
  for (const match of text.matchAll(PARAM)) {
    const position = Number(match[1]);
    if (!seen.includes(position)) seen.push(position);
  }
  return seen;
}

function approved(name: TemplateName): ApprovedTemplate {
  if (name === "login_code_v1") {
    // WhatsApp writes an authentication template's words itself; we give the code, which its button copies.
    const copy: ApprovedButton = { kind: "copy_code" };
    return { name, category: "authentication", body: "", takes: [1], imageHeader: false, buttons: [copy] };
  }
  const differs = DIFFERS[name];
  const text = differs?.text ?? TEMPLATES[name];
  const takes = positionsIn(text);
  const body = text.replace(PARAM, (_match, position: string) => `{{${String(takes.indexOf(Number(position)) + 1)}}}`);
  return {
    name,
    category: "utility",
    body,
    takes,
    imageHeader: name === "tryon_result_v1",
    buttons: differs?.buttons ?? [],
  };
}

/** Every template to submit for approval, in the order TEMPLATES lists them. */
export const APPROVED_TEMPLATES: readonly ApprovedTemplate[] = (Object.keys(TEMPLATES) as TemplateName[])
  .filter((name) => !NOT_SUBMITTED.has(name))
  .map(approved);

/** The approved form of a template; null for one never submitted. */
export function approvedTemplate(name: TemplateName): ApprovedTemplate | null {
  return APPROVED_TEMPLATES.find((template) => template.name === name) ?? null;
}

/** Our params in the approved template's order; null when one it takes is missing. */
export function approvedParams(template: ApprovedTemplate, params: readonly string[]): string[] | null {
  const values = template.takes.map((position) => params[position - 1]);
  return values.every((value): value is string => value !== undefined) ? values : null;
}
