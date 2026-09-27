import { useState } from "preact/hooks";
import { ICONS } from "@maneman/brand/icons";
import type { LossExtent } from "../../../../src/config/booking.ts";
import { referral } from "../../content/referral.ts";
import { track } from "../../lib/analytics.ts";
import { joinPublicWaitlist, joinWaitlist } from "../../lib/api.ts";
import { mobileDigits } from "../../lib/phone.ts";
import { fill } from "../../lib/text.ts";
import { readAttribution } from "../../lib/visit.ts";
import { Icon } from "../Drawings.tsx";
import type { Listing } from "./Done.tsx";
import { ExtentFieldset, ForPincode, PersonFieldset, Send, type FormProps } from "./fields.tsx";
import styles from "./Invite.module.css";
import { codeInPath } from "./page.ts";
import { useTurnstileForm } from "./useTurnstileForm.ts";

/** Board C3: we do not come there yet, so the page takes a number instead. */
export function Waitlist(props: FormProps & { onListed: (listing: Listing) => void }) {
  const form = useTurnstileForm(props.turnstileSiteKey);
  const [alert, setAlert] = useState(false);
  const [extent, setExtent] = useState<LossExtent>("crown");

  function submit(event: Event) {
    const { fields } = form;
    const request = {
      name: fields.name.trim(),
      mobile: mobileDigits(fields.mobile),
      pincode: props.answer.pincode,
      contact_consent: true as const,
      launch_alert: alert,
    };
    const attribution = readAttribution();
    const onBook = { ...request, loss_extent: extent, ...(attribution === undefined ? {} : { attribution }) };
    void form.submit(
      event,
      (token, keyFor) =>
        props.invited
          ? joinWaitlist(codeInPath(), { ...request, turnstile_token: token }, keyFor(request))
          : joinPublicWaitlist({ ...onBook, turnstile_token: token }, keyFor(onBook)),
      (listed) => {
        const page = props.invited ? "invite" : "book";
        const loss_extent = props.invited ? null : extent;
        track({ name: "lead_submitted", page, served: false, area: props.answer.area, window: null, loss_extent });
        track({ name: "waitlist_submitted", page, area: listed.area });
        props.onListed({ credits: false, invite: "unknown", ...listed });
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
    <form class={styles.form} onSubmit={submit} noValidate>
      <div>
        <h2 class={styles.waitlistTitle}>{waitlist.leave}</h2>
        <ForPincode text={forPincode} onChange={props.onChangePincode} />
      </div>

      {!props.invited && <ExtentFieldset extent={extent} onChange={setExtent} />}

      <PersonFieldset
        fields={form.fields}
        touched={form.touched}
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

      <div ref={form.box} class={styles.turnstile} />
      <Send failure={form.failure} sending={form.sending} label={waitlist.submit} sendingLabel={waitlist.sending} />
      {props.credits && (
        <p class={styles.told}>
          {props.name === null ? waitlist.holdsUnnamed : fill(waitlist.holds, { name: props.name })}
        </p>
      )}
    </form>
  );
}
