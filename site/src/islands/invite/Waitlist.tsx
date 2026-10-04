import { useState } from "preact/hooks";
import { ICONS } from "@maneman/brand/icons";
import type { LossExtent } from "../../../../src/config/booking.ts";
import { referral } from "../../content/referral.ts";
import { track } from "../../lib/analytics.ts";
import { joinPublicWaitlist, joinWaitlist } from "../../lib/api.ts";
import { forgetInvite, rememberedInvite } from "../../lib/remembered-invite.ts";
import { fill } from "../../lib/text.ts";
import { Icon } from "../Drawings.tsx";
import type { Listing } from "./Done.tsx";
import { ExtentFieldset, ForPincode, PersonFieldset, RememberedInvite, Send, type FormProps } from "./fields.tsx";
import styles from "./Invite.module.css";
import { codeInPath } from "./page.ts";
import { byDoor, leadSent } from "./submit.ts";
import { mobileToSend, useTurnstileForm } from "./useTurnstileForm.ts";

/** Board C3: we do not come there yet, so the page takes a number instead. */
export function Waitlist(props: FormProps & { onListed: (listing: Listing) => void }) {
  const form = useTurnstileForm(props.turnstileSiteKey);
  const [alert, setAlert] = useState(false);
  const [extent, setExtent] = useState<LossExtent | null>(null);
  // On /book, the invite this browser remembers: the form says who is told of the fit before it sends it.
  const [remembered, setRemembered] = useState(() => (props.invited ? null : rememberedInvite()));

  function joinWithoutInvite() {
    if (remembered !== null) forgetInvite(remembered);
    setRemembered(null);
  }

  function submit(event: Event) {
    const { fields } = form;
    const request = {
      name: fields.name.trim(),
      mobile: mobileToSend(fields),
      pincode: props.answer.pincode,
      contact_consent: true as const,
      launch_alert: alert,
    };
    const door = { invited: props.invited, credits: props.credits, extent, remembered };
    const { onInvite, onBook } = byDoor(request, door);
    void form.submit(
      event,
      (token, keyFor) =>
        props.invited
          ? joinWaitlist(codeInPath(), { ...onInvite, turnstile_token: token }, keyFor(onInvite))
          : joinPublicWaitlist({ ...onBook, turnstile_token: token }, keyFor(onBook)),
      (listed) => {
        const page = leadSent(door, { served: false, area: props.answer.area, window: null });
        track({ name: "waitlist_submitted", page, area: listed.area });
        props.onListed({ ...listed, pincode: props.answer.pincode, alerted: alert });
      },
    );
  }

  const { waitlist } = referral;
  const area = props.answer.area;
  const forPincode = fill(waitlist.forPincode, {
    pincode: props.answer.pincode,
    area: area === null ? "" : `, ${area}`,
  });
  return (
    <form ref={form.element} class={styles.form} onSubmit={submit} noValidate>
      <div>
        <h2 class={styles.waitlistTitle}>{waitlist.leave}</h2>
        <ForPincode text={forPincode} onChange={props.onChangePincode} />
      </div>

      {!props.invited && <ExtentFieldset extent={extent} onChange={setExtent} />}

      <PersonFieldset
        fields={form.fields}
        bad={form.personBad}
        idPrefix="invite-waitlist"
        consentLabel={waitlist.contactConsent}
        consentNote={waitlist.required}
        onChange={form.setFields}
      />

      <label class={styles.consent}>
        <input
          type="checkbox"
          class="visually-hidden"
          checked={alert}
          onChange={(event) => {
            setAlert(event.currentTarget.checked);
          }}
        />
        <span class={styles.box} aria-hidden="true">
          {alert && <Icon path={ICONS.tick} size={13} stroke={1.7} />}
        </span>
        <span class={styles.consentText}>
          {waitlist.launchAlert}
          <span class={styles.consentNote}>{` ${waitlist.optional}`}</span>
        </span>
      </label>

      {remembered !== null && (
        <RememberedInvite
          line={referral.remembered.waitlist}
          without={referral.remembered.joinWithout}
          onWithout={joinWithoutInvite}
        />
      )}

      <div ref={form.box} class={styles.turnstile} />
      <Send
        failure={form.failure}
        marked={form.personBad.length}
        sending={form.sending}
        label={waitlist.submit}
        sendingLabel={waitlist.sending}
      />
      {props.credits && (
        <p class={styles.told}>
          {props.name === null ? waitlist.holdsUnnamed : fill(waitlist.holds, { name: props.name })}
        </p>
      )}
    </form>
  );
}
