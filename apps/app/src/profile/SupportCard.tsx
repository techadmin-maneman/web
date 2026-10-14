// The account's support card: WhatsApp, where the team answers, and the client's Care person by name.

import { ButtonLink } from "@maneman/ui/Button";
import { capsLook } from "@maneman/ui/Caps";
import { ICONS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { whatsappChat } from "@maneman/web-kit/whatsapp";
import { profile, whatsapp } from "../content.ts";
import styles from "./profile.module.css";

export function SupportCard({
  carePerson,
  hours,
}: {
  readonly carePerson: string | null;
  readonly hours: { readonly opens: number; readonly closes: number; readonly first_reply: number };
}) {
  const copy = profile.support;
  const open = copy.hours(copy.hour(hours.opens), copy.hour(hours.closes));
  return (
    <section className={styles.card} aria-labelledby="support">
      <h2 className={capsLook(styles.cardLabel)} id="support">
        {copy.label}
      </h2>
      <ButtonLink
        variant="outline"
        size="action"
        className={styles.whatsapp}
        href={whatsappChat(whatsapp.number)}
        rel="noopener"
      >
        <Icon d={ICONS.whatsapp} size={21} />
        <span>{copy.message}</span>
      </ButtonLink>
      {carePerson !== null && <p className={styles.cardHint}>{copy.carePerson(carePerson)}</p>}
      <p className={styles.cardHint}>{copy.hint(copy.within(hours.first_reply), open)}</p>
    </section>
  );
}
