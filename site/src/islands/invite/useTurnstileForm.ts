import { useEffect, useRef, useState } from "preact/hooks";
import { mobileDigits } from "@maneman/web-kit/mobile";
import { isPersonName } from "@maneman/web-kit/names";
import { turnstileWidget, type TurnstileWidget } from "@maneman/web-kit/turnstile";
import { referral } from "../../content/referral.ts";
import type { Answer, Code } from "../../lib/api.ts";
import { useSubmission } from "../useSubmission.ts";
import { isOneOf } from "@rules/lib/one-of.ts";
import type { PersonFields } from "./person.ts";

export type { PersonFields };

/** The person's fields, by the names the API gives them when it refuses one. */
export const PERSON_FIELDS = ["name", "mobile", "consent"] as const;
export type PersonField = (typeof PERSON_FIELDS)[number];

const isPersonField = (field: string): field is PersonField => isOneOf(PERSON_FIELDS, field);

/** The ten digits a form sends. Empty while the field holds no mobile number, when submit sends nothing anyway. */
export function mobileToSend(fields: PersonFields): string {
  return mobileDigits(fields.mobile) ?? "";
}

/** The person's fields that cannot be sent as they stand. */
function personProblems(fields: PersonFields): PersonField[] {
  const problems: PersonField[] = [];
  if (!isPersonName(fields.name)) problems.push("name");
  if (mobileDigits(fields.mobile) === null) problems.push("mobile");
  if (!fields.consent) problems.push("consent");
  return problems;
}

/** What a form says when the API refuses it. */
function refusal(code: Code): string {
  const { errors } = referral;
  if (code === "rate_limited") return errors.rateLimited;
  if (code === "turnstile_failed") return errors.turnstile;
  if (code === "taken") return errors.taken;
  if (code === "not_bookable") return errors.notBookable;
  if (code === "code_not_applicable") return errors.codeNotApplicable;
  if (code === "no_product") return errors.noProduct;
  if (code === "number_not_proved") return errors.notProved;
  if (code === "network") return errors.network;
  return errors.other;
}

/**
 * A form's Turnstile widget: made once the visitor starts on the form and removed with it, so no challenge runs for a
 * page that is only read. `ensure()` makes it for a form sent without ever being focused, as a button pressed in
 * Safari leaves it.
 */
function useFormWidget(
  element: { readonly current: HTMLFormElement | null },
  box: { readonly current: HTMLDivElement | null },
  siteKey: string,
) {
  const widget = useRef<TurnstileWidget | null>(null);
  useEffect(() => {
    const form = element.current;
    const container = box.current;
    if (form === null || container === null) return;
    const start = () => {
      widget.current ??= turnstileWidget(container, siteKey);
    };
    form.addEventListener("focusin", start);
    form.addEventListener("input", start);
    return () => {
      form.removeEventListener("focusin", start);
      form.removeEventListener("input", start);
      void widget.current?.remove();
      widget.current = null;
    };
  }, [element, box, siteKey]);
  const ensure = () => {
    if (widget.current === null && box.current !== null) widget.current = turnstileWidget(box.current, siteKey);
    return widget.current;
  };
  return { widget, ensure };
}

/**
 * What the consultation and the waitlist forms share: the person's fields, whether they have been checked, and
 * sending them with a Turnstile token. The widget is made once the visitor starts on the form, and removed with it:
 * the box it renders into does not exist until the pincode has decided which form the page shows. `marks` are the fields, by the API's names, that the
 * form marks itself when a refusal names them; a refusal that names none of them is said by the button. On /book the
 * name and number are given first (./AboutYou.tsx), and the forms after it start from them.
 */
export function useTurnstileForm(
  siteKey: string,
  marks: readonly string[] = PERSON_FIELDS,
  given: PersonFields = { name: "", mobile: "", consent: false },
) {
  const [fields, setFields] = useState<PersonFields>(given);
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const submission = useSubmission(marks);
  const { touched, failure, setFailure, refusedFields, form: element, keyFor } = submission;

  const { widget, ensure } = useFormWidget(element, box, siteKey);

  const problems = personProblems(fields);
  /** The person's fields to mark: those wrong once the form was checked, and those the API refused. */
  const personBad = PERSON_FIELDS.filter(
    (field) => (touched && problems.includes(field)) || refusedFields.includes(field),
  );

  /** A change to the person's fields. A field the API refused is no longer marked once it has been changed. */
  function changeFields(next: PersonFields) {
    submission.unmark((field) => isPersonField(field) && next[field] !== fields[field]);
    setFields(next);
  }

  /** A refusal: fields the form marks are marked and the first focused; any other refusal is said by the button. */
  function refused(code: Code, named: readonly string[]) {
    if (!submission.markRefused(code, named)) setFailure(refusal(code));
  }

  /**
   * Checks the fields, then sends: `send` makes the request with the token, keying it by its body without the token,
   * so pressing again after a lost answer is the same request. A refusal shows on the form; an answer goes to `sent`.
   * `complete` is false while the form's own fields, beyond the person's, have one left to fill in: the booking's
   * address. Nothing is sent then either.
   */
  async function submit<T>(
    event: Event,
    send: (token: string, keyFor: (request: unknown) => string) => Promise<Answer<T>>,
    sent: (body: T) => void,
    complete = true,
  ) {
    event.preventDefault();
    if (sending) return;
    if (!complete || problems.length > 0) {
      submission.stopAtFields();
      return;
    }
    setSending(true);
    submission.starting();
    const token = (await ensure()?.token()) ?? null;
    if (token === null) {
      setFailure(referral.errors.turnstile);
      setSending(false);
      return;
    }
    const result = await send(token, keyFor);
    void widget.current?.renew();
    setSending(false);
    if (!result.ok) {
      refused(result.code, result.fields);
      return;
    }
    sent(result.body);
  }

  /** Moving on from a step: what it last said no longer stands. */
  function clearFailure() {
    setFailure(null);
  }

  return {
    fields,
    setFields: changeFields,
    touched,
    sending,
    failure,
    clearFailure,
    refusedFields,
    personBad,
    box,
    element,
    submit,
  };
}
