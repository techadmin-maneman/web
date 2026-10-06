// The help screen (design/phase2/Client App), reached from the code screen by the client's
// choice rather than by the API's answer, so it never says whether a number
// has a booking (docs/decisions/0030-one-time-codes.md).

import { IconButton } from "@maneman/ui/IconButton";
import { ICONS } from "@maneman/brand/icons";
import { ButtonLink } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { whatsappChat } from "@maneman/web-kit/whatsapp";
import { BOOKING_URL, login, whatsapp } from "../content.ts";
import styles from "./login.module.css";

export function HelpScreen({ onBack }: { onBack: () => void }) {
  const copy = login.help;
  return (
    <main className={styles.screen}>
      <div className={styles.top}>
        <IconButton className={styles.back} d={ICONS.back} size={22} label={copy.back} onClick={onBack} />
      </div>
      <div className={styles.body}>
        <h1 className={styles.helpTitle}>{copy.title}</h1>
        <p className={styles.helpBody}>{copy.body}</p>
        <p className={styles.helpBox}>{copy.hint}</p>
        <div className={styles.buttons}>
          <ButtonLink
            variant="light"
            size="action"
            className={styles.primary}
            href={BOOKING_URL[import.meta.env.MM_ENV]}
          >
            {copy.book}
          </ButtonLink>
          <ButtonLink
            variant="outlineOnInk"
            size="action"
            className={styles.secondary}
            href={whatsappChat(whatsapp.number)}
            rel="noopener"
          >
            <Icon d={ICONS.whatsapp} size={19} />
            {copy.message}
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
