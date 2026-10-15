// The help screen (design/phase2/Client App), reached from the code screen by the client's
// choice rather than by the API's answer, so it never says whether a number
// has a booking (docs/decisions/0030-one-time-codes.md).

import { IconButton } from "@maneman/ui/IconButton";
import { ICONS } from "@maneman/brand/icons";
import { ButtonLink } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { whatsappChat } from "@maneman/web-kit/whatsapp";
import { BOOKING_URL, login, whatsapp } from "../content.ts";
import shared from "./login.module.css";
import styles from "./help-screen.module.css";

export function HelpScreen({ onBack }: { onBack: () => void }) {
  const copy = login.help;
  return (
    <main className={shared.screen}>
      <div className={shared.top}>
        <IconButton className={shared.back} d={ICONS.back} size="md" label={copy.back} onClick={onBack} />
      </div>
      <div className={shared.body}>
        <h1 className={styles.helpTitle}>{copy.title}</h1>
        <p className={styles.helpBody}>{copy.body}</p>
        <p className={styles.helpBox}>{copy.hint}</p>
        <div className={styles.buttons}>
          <ButtonLink
            variant="light"
            size="action"
            className={shared.primary}
            href={BOOKING_URL[import.meta.env.MM_ENV]}
          >
            {copy.book}
          </ButtonLink>
          <ButtonLink
            variant="outlineOnInk"
            size="action"
            className={shared.secondary}
            href={whatsappChat(whatsapp.number)}
            rel="noopener"
          >
            <Icon d={ICONS.whatsapp} size="sm" />
            {copy.message}
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
