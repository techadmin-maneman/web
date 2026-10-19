// The person a booking form is for, as every form holds them (./useTurnstileForm.ts).

/** The name, the number and the agreement. */
export interface PersonFields {
  name: string;
  /** As the field shows it, "98100 00000"; mobileToSend reads it. */
  mobile: string;
  consent: boolean;
}

/** A consultation form's fields before anything is typed here: empty, and the WhatsApp line ticked (ADR 0213). */
export const PERSON_START: PersonFields = { name: "", mobile: "", consent: true };
