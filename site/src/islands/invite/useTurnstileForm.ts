import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { mobileDigits } from "@maneman/web-kit/mobile";
import { referral } from "../../content/referral.ts";
import type { AlreadyBooked, Answer, ErrorCode } from "../../lib/api.ts";
import { bookedHeadline } from "../../lib/dates.ts";
import { keyPerRequest } from "../../lib/idempotency.ts";
import { fill } from "../../lib/text.ts";
import { turnstileWidget } from "../../lib/turnstile.ts";
import { windowHours } from "./Done.tsx";

/** What both forms hold: the name, the number and the agreement. */
export interface PersonFields {
  name: string;
  /** As the field shows it, "98100 00000"; mobileToSend reads it. */
  mobile: string;
  consent: boolean;
}

/** The ten digits a form sends. Empty while the field holds no mobile number, when submit sends nothing anyway. */
export function mobileToSend(fields: PersonFields): string {
  return mobileDigits(fields.mobile) ?? "";
}

/** What a form says when the API refuses it. */
function refusal(code: ErrorCode | "network", booked: AlreadyBooked | undefined): string {
  const { errors } = referral;
  if (booked !== undefined) {
    return fill(errors.alreadyBooked, { when: bookedHeadline(booked.date, windowHours(booked.window)) });
  }
  if (code === "rate_limited") return errors.rateLimited;
  if (code === "turnstile_failed") return errors.turnstile;
  if (code === "taken") return errors.taken;
  if (code === "not_bookable") return errors.notBookable;
  if (code === "code_not_applicable") return errors.codeNotApplicable;
  return errors.other;
}

/**
 * What the consultation and the waitlist forms share: the person's fields, whether they have been checked, and
 * sending them with a Turnstile token. The widget is made when the form appears: the box it renders into does not
 * exist until the pincode has decided which form the page shows.
 */
export function useTurnstileForm(siteKey: string) {
  const [fields, setFields] = useState<PersonFields>({ name: "", mobile: "", consent: false });
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<ReturnType<typeof turnstileWidget> | null>(null);
  const keyFor = useMemo(keyPerRequest, []);

  useEffect(() => {
    if (box.current !== null) widget.current = turnstileWidget(box.current, siteKey);
  }, [siteKey]);

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
    if (!complete || fields.name.trim() === "" || mobileDigits(fields.mobile) === null || !fields.consent) {
      setTouched(true);
      return;
    }
    setSending(true);
    setFailure(null);
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
      if (result.code === "invalid_request") setTouched(true);
      setFailure(refusal(result.code, result.booked));
      return;
    }
    sent(result.body);
  }

  return { fields, setFields, touched, sending, failure, box, submit };
}
