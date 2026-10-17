// /book's first step: the name and number, with the agreement the consultation asks for, kept as a lead before
// anything else is asked (docs/decisions/0116-book-asks-for-the-name-and-number-first.md). Someone who stops at the
// slot or the address has left what we need to call them. The steps after it start from what it kept.

import { referral } from "../../content/referral.ts";
import { booking } from "../../content/site.ts";
import { leaveLead } from "../../lib/api.ts";
import { readAttribution } from "../../lib/visit.ts";
import { PersonFieldset, Send, StepLine } from "./fields.tsx";
import styles from "./Invite.module.css";
import { mobileToSend, useTurnstileForm, type PersonFields } from "./useTurnstileForm.ts";

/** Whether the fields hold the name and number kept already, so there is nothing new to keep. */
const sameAs = (kept: PersonFields, fields: PersonFields): boolean =>
  kept.name.trim() === fields.name.trim() && mobileToSend(kept) === mobileToSend(fields) && fields.consent;

export function AboutYou(props: {
  turnstileSiteKey: string;
  /** What this step kept before, when the visitor has come back to it. */
  kept: PersonFields | null;
  onKept: (fields: PersonFields) => void;
}) {
  const form = useTurnstileForm(props.turnstileSiteKey, undefined, props.kept ?? undefined);

  function submit(event: Event) {
    const { fields } = form;
    if (props.kept !== null && sameAs(props.kept, fields)) {
      event.preventDefault();
      props.onKept(fields);
      return;
    }
    const attribution = readAttribution();
    const request = {
      name: fields.name.trim(),
      mobile: mobileToSend(fields),
      consent: true as const,
      ...(attribution === undefined ? {} : { attribution }),
    };
    void form.submit(
      event,
      (token, keyFor) => leaveLead({ ...request, turnstile_token: token }, keyFor(request)),
      () => {
        props.onKept(fields);
      },
    );
  }

  return (
    <form ref={form.element} class={styles.form} onSubmit={submit} noValidate>
      <StepLine at={1} name={booking.steps.you} focus={props.kept !== null} />
      <PersonFieldset
        fields={form.fields}
        bad={form.personBad}
        idPrefix="book-you"
        consentLabel={referral.consultation.consent}
        consentNote=""
        onChange={form.setFields}
      />
      <div ref={form.box} class={styles.turnstile} />
      <Send
        failure={form.failure}
        marked={form.personBad.length}
        sending={form.sending}
        label={booking.next}
        sendingLabel={booking.saving}
      />
    </form>
  );
}
