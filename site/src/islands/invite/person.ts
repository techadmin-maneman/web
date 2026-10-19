// The person a booking form is for, as every form holds them (./useTurnstileForm.ts).

import { formatMobileField } from "@maneman/web-kit/mobile";
import { rememberedVisitor } from "../../lib/visitor.ts";

/** The name, the number and the agreement. */
export interface PersonFields {
  name: string;
  /** As the field shows it, "98100 00000"; mobileToSend reads it. */
  mobile: string;
  consent: boolean;
}

/**
 * A consultation form's fields before anything is typed here: the name and number given at the try-on in this tab, if
 * any (ADR 0214), and the WhatsApp line ticked (ADR 0213).
 */
export function consultationStart(): PersonFields {
  const visitor = rememberedVisitor();
  if (visitor === null) return { name: "", mobile: "", consent: true };
  return { name: visitor.name, mobile: formatMobileField(visitor.mobile), consent: true };
}
