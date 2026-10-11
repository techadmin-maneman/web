// The account's support card: WhatsApp, where the team answers, and the client's Care person by name.

import { capsLook } from "@maneman/ui/Caps";
import { ICONS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { whatsappChat } from "@maneman/web-kit/whatsapp";
import { profile, whatsapp } from "../content.ts";
import styles from "./profile.module.css";

export function SupportCard({ carePerson }: { readonly carePerson: string | null }) {
  const copy = profile.support;
  return (
    <section className={styles.card} aria-labelledby="support">
      <h2 className={capsLook(styles.cardLabel)} id="support">
        {copy.label}
      </h2>
      <a className={styles.whatsapp} href={whatsappChat(whatsapp.number)} rel="noopener">
        <Icon d={ICONS.whatsapp} size={21} />
        <span>{copy.message}</span>
      </a>
      {carePerson !== null && <p className={styles.cardHint}>{copy.carePerson(carePerson)}</p>}
      <p className={styles.cardHint}>{copy.hint}</p>
    </section>
  );
}
