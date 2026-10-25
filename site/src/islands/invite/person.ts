// The person a booking form is for, as every form holds them (./useTurnstileForm.ts).

/** The name, the number and the agreements. */
export interface PersonFields {
  name: string;
  /** As the field shows it, "98100 00000"; mobileToSend reads it. */
  mobile: string;
  consent: boolean;
  /** The terms and the privacy policy, ticked by the visitor; null on a form that books nothing, the waitlist. */
  terms: boolean | null;
}

/**
 * A consultation form's fields before anything is typed here: empty, the WhatsApp line ticked (ADR 0213), and the terms
 * for the visitor to tick themselves.
 */
export const PERSON_START: PersonFields = { name: "", mobile: "", consent: true, terms: false };
