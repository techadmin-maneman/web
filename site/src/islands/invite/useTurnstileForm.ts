import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { mobileDigits } from "@maneman/web-kit/mobile";
import { isPersonName } from "@maneman/web-kit/names";
import { turnstileWidget, type TurnstileWidget } from "@maneman/web-kit/turnstile";
import { referral } from "../../content/referral.ts";
import type { Answer, ErrorCode } from "../../lib/api.ts";
import { keyPerRequest } from "../../lib/idempotency.ts";
import { useInvalidFocus } from "../useInvalidFocus.ts";

/** What both forms hold: the name, the number and the agreement. */
export interface PersonFields {
  name: string;
  /** As the field shows it, "98100 00000"; mobileToSend reads it. */
  mobile: string;
  consent: boolean;
}

/** The person's fields, by the names the API gives them when it refuses one. */
export const PERSON_FIELDS = ["name", "mobile", "consent"] as const;
export type PersonField = (typeof PERSON_FIELDS)[number];

const isPersonField = (field: string): field is PersonField => (PERSON_FIELDS as readonly string[]).includes(field);

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
function refusal(code: ErrorCode | "network"): string {
  const { errors } = referral;
  if (code === "rate_limited") return errors.rateLimited;
  if (code === "turnstile_failed") return errors.turnstile;
  if (code === "taken") return errors.taken;
  if (code === "not_bookable") return errors.notBookable;
  if (code === "code_not_applicable") return errors.codeNotApplicable;
  if (code === "no_product") return errors.noProduct;
  if (code === "number_not_proved") return errors.notProved;
  return errors.other;
}

/**
 * What the consultation and the waitlist forms share: the person's fields, whether they have been checked, and
 * sending them with a Turnstile token. The widget is made when the form appears: the box it renders into does not
 * exist until the pincode has decided which form the page shows. `marks` are the fields, by the API's names, that the
 * form marks itself when a refusal names them; a refusal that names none of them is said by the button.
 */
export function useTurnstileForm(siteKey: string, marks: readonly string[] = PERSON_FIELDS) {
  const [fields, setFields] = useState<PersonFields>({ name: "", mobile: "", consent: false });
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // The fields the last refusal named that the form marks.
  const [refusedFields, setRefusedFields] = useState<readonly string[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const element = useRef<HTMLFormElement>(null);
  const widget = useRef<TurnstileWidget | null>(null);
  const keyFor = useMemo(keyPerRequest, []);
  const showInvalid = useInvalidFocus(element);

  useEffect(() => {
    if (box.current !== null) widget.current = turnstileWidget(box.current, siteKey);
  }, [siteKey]);

  const problems = personProblems(fields);
  /** The person's fields to mark: those wrong once the form was checked, and those the API refused. */
  const personBad = PERSON_FIELDS.filter(
    (field) => (touched && problems.includes(field)) || refusedFields.includes(field),
  );

  /** A change to the person's fields. A field the API refused is no longer marked once it has been changed. */
  function changeFields(next: PersonFields) {
    setRefusedFields((refused) => refused.filter((field) => !isPersonField(field) || next[field] === fields[field]));
    setFields(next);
  }

  /** A refusal: fields the form marks are marked and the first focused; any other refusal is said by the button. */
  function refused(code: ErrorCode | "network", named: readonly string[]) {
    const marked = named.filter((field) => marks.includes(field));
    if (code === "invalid_request") setTouched(true);
    setRefusedFields(marked);
    if (marked.length === 0) {
      setFailure(refusal(code));
      return;
    }
    setFailure(null);
    showInvalid();
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
      setTouched(true);
      setFailure(null);
      showInvalid();
      return;
    }
    setSending(true);
    setFailure(null);
    setRefusedFields([]);
    const token = (await widget.current?.token()) ?? null;
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

  return { fields, setFields: changeFields, touched, sending, failure, refusedFields, personBad, box, element, submit };
}
