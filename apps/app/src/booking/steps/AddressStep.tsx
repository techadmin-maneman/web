// The address before the day and time, for a client who has given none (ADR 0079) or changes theirs from the review,
// and the answer for an address in a pincode we do not come to.

import { AddressForm } from "../../profile/index.ts";
import { ButtonLink } from "@maneman/ui/Button";
import type { Address } from "../../api.ts";
import { booking, BOOKING_URL, profile } from "../../content.ts";
import styles from "../booking.module.css";
import { Frame, type StepAt } from "./shared.tsx";

/**
 * The address, before any time, for a client who has given none, or the one saved, changed from the review: Profile's
 * own form, under its heading. `refused`: the API refused a hold for want of one, so the sheet came back here. `step`:
 * where it stands among the steps; none for a change from the review.
 */
export function AddressStep(props: {
  refused: boolean;
  /** The address saved, being changed; null where there is none yet. */
  address: Address | null;
  step: StepAt | undefined;
  onSaved: () => void;
  onClose: () => void;
}) {
  const copy = booking.address;
  return (
    <Frame title={profile.where} step={props.step} onClose={props.onClose}>
      {props.address === null && (
        <p className={styles.why} role={props.refused ? "alert" : undefined}>
          {props.refused ? copy.refused : copy.why}
        </p>
      )}
      <AddressForm address={props.address} saveLabel={copy.save} onSaved={props.onSaved} />
    </Frame>
  );
}

/**
 * The address saved is in a pincode we do not come to, so no day is offered. The client changes it
 * in Profile's own form, or joins the waitlist on the site.
 */
export function NotServedStep(props: { address: Address; onSaved: () => void; onClose: () => void }) {
  const { address, onSaved } = props;
  const copy = booking.notServed;
  return (
    <Frame title={profile.where} onClose={props.onClose}>
      <p className={styles.why} role="alert">
        {copy.line(address.pincode)} {copy.body}
      </p>
      <AddressForm address={address} saveLabel={booking.address.save} onSaved={onSaved} />
      <ButtonLink
        variant="outline"
        size="control"
        className={styles.secondary}
        href={BOOKING_URL[import.meta.env.MM_ENV]}
      >
        {copy.waitlist}
      </ButtonLink>
    </Frame>
  );
}
