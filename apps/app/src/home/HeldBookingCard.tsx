// A visit ops booked for the client that waits on the payment link they sent (src/routes/client/held-bookings.ts):
// on Home, with the link to pay, so it can be paid whether or not the text reached them. Read by itself, so Home never
// waits on it; nothing shows where it cannot be read.

import { TextLink } from "@maneman/ui/TextLink";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { api, type HeldBooking } from "../api.ts";
import { home, VISIT_TYPES } from "../content.ts";
import styles from "./home.module.css";

const copy = home.heldBooking;

/** "Sun 22 Nov at 10 am", or the day alone for one held before holds kept their start. */
function whenOf(held: HeldBooking): string {
  const day = shortDate(held.date);
  return held.starts_at === null ? day : `${day} at ${indiaClock(held.starts_at)}`;
}

/** "7 am Sun 22 Nov": the moment paying it last books it. */
const untilOf = (held: HeldBooking) => `${indiaClock(held.open_until)} ${shortDate(indiaDate(held.open_until))}`;

export function HeldBookingCard() {
  const [loaded] = useLoad(api.heldBookings);
  if (loaded.state !== "loaded") return null;
  return (
    <>
      {loaded.value.held.map((held) => (
        <div className={styles.prompt} key={held.pay_url}>
          <p className={styles.promptLine}>
            {copy.line(VISIT_TYPES[held.type].toLowerCase(), whenOf(held), untilOf(held))}
          </p>
          <TextLink tone="brass" className={styles.promptLink} href={held.pay_url} newTab>
            <span>{copy.pay(rupees(held.amount))}</span>
          </TextLink>
        </div>
      ))}
    </>
  );
}
