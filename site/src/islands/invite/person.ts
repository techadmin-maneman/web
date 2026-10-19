// The person a booking form is for, as every form holds them (./useTurnstileForm.ts).

import { formatMobileField } from "@maneman/web-kit/mobile";
import { useEffect, useRef } from "preact/hooks";
import { rememberedVisitor } from "../../lib/visitor.ts";

/** The name, the number and the agreement. */
export interface PersonFields {
  name: string;
  /** As the field shows it, "98100 00000"; mobileToSend reads it. */
  mobile: string;
  consent: boolean;
}

/** A consultation form's fields before anything is typed here: empty, and the WhatsApp line ticked (ADR 0213). */
export const PERSON_START: PersonFields = { name: "", mobile: "", consent: true };

/**
 * The name and number given at the try-on in this tab, if any (ADR 0214), put in the fields once the form is drawn.
 * The server drew the fields empty, and hydrating keeps what it drew, so fields that started from them would show
 * nothing until something else drew the form again.
 */
export function useRememberedPerson(empty: boolean, setFields: (fields: PersonFields) => void): void {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !empty) return;
    done.current = true;
    const visitor = rememberedVisitor();
    if (visitor !== null) setFields({ name: visitor.name, mobile: formatMobileField(visitor.mobile), consent: true });
  }, [empty, setFields]);
}
