// Board C2's address before the date, for a client who has given none (ADR 0079), and the answer for an address
// in a pincode we do not come to.

import { ButtonLink } from "@maneman/ui/Button";
import type { Address } from "../../api.ts";
import { booking, BOOKING_URL, profile } from "../../content.ts";
import { AddressForm } from "../../profile/AddressForm.tsx";
import styles from "../booking.module.css";
import { Heading } from "./shared.tsx";

/**
 * The address, before any slot, for a client who has given none (ADR 0079): Profile's own form, under its heading.
 * No board draws it. `refused`: the API refused a hold for want of one, so the sheet came back here. `before`: the
 * steps the sheet takes before the date, of which this is the last.
 */
export function AddressStep({ refused, before, onSaved }: { refused: boolean; before: number; onSaved: () => void }) {
  const copy = booking.address;
  return (
    <>
      <Heading title={profile.where} step={booking.step(before, 3 + before)} />
      <p className={styles.why} role={refused ? "alert" : undefined}>
        {refused ? copy.refused : copy.why}
      </p>
      <AddressForm address={null} saveLabel={copy.save} onSaved={onSaved} />
    </>
  );
}

/**
 * No board draws it: the address saved is in a pincode we do not come to, so no day is offered. The client changes it
 * in Profile's own form, or joins the waitlist on the site.
 */
export function NotServedStep({ address, onSaved }: { address: Address; onSaved: () => void }) {
  const copy = booking.notServed;
  return (
    <>
      <Heading title={profile.where} />
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
    </>
  );
}
