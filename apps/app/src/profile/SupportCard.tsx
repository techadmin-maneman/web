// The account's support card (board G2): WhatsApp, where the team answers.

import { ICONS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { whatsappChat } from "@maneman/web-kit/whatsapp";
import { profile, whatsapp } from "../content.ts";
import styles from "./profile.module.css";

export function SupportCard() {
  const copy = profile.support;
  return (
    <section className={styles.card} aria-labelledby="support">
      <h2 className={styles.cardLabel} id="support">
        {copy.label}
      </h2>
      <a className={styles.whatsapp} href={whatsappChat(whatsapp.number)} rel="noopener">
        <Icon d={ICONS.whatsapp} size={21} />
        <span>{copy.message}</span>
      </a>
      <p className={styles.cardHint}>{copy.hint}</p>
    </section>
  );
}
