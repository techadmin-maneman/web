// A3 (design/phase2/Client App, board A3), reached from A2 by the client's
// choice rather than by the API's answer, so it never says whether a number
// has a booking (docs/decisions/0030-one-time-codes.md).

import { ICONS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { BOOKING_URL, login, whatsapp } from "../content.ts";
import styles from "./login.module.css";

export function HelpScreen({ onBack }: { onBack: () => void }) {
  const copy = login.help;
  return (
    <main className={styles.screen}>
      <div className={styles.top}>
        <button className={styles.back} type="button" onClick={onBack} aria-label={copy.back}>
          <Icon d={ICONS.back} size={22} />
        </button>
      </div>
      <div className={styles.body}>
        <h1 className={styles.helpTitle}>{copy.title}</h1>
        <p className={styles.helpBody}>{copy.body}</p>
        <p className={styles.helpBox}>{copy.hint}</p>
        <div className={styles.buttons}>
          <a className={styles.primary} href={BOOKING_URL[import.meta.env.MM_ENV] ?? BOOKING_URL.production}>
            {copy.book}
          </a>
          <a className={styles.secondary} href={`https://wa.me/${whatsapp.number}`} rel="noopener">
            <Icon d={ICONS.whatsapp} size={19} />
            {copy.message}
          </a>
        </div>
      </div>
    </main>
  );
}
