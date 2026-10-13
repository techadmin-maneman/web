// The way out of a limit on codes: a WhatsApp chat with us, under the line that names the limit.

import { ICONS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { TextLink } from "@maneman/ui/TextLink";
import { whatsappChat } from "@maneman/web-kit/whatsapp";
import { login, whatsapp } from "../content.ts";
import styles from "./login.module.css";

export function MessageUs() {
  return (
    <TextLink tone="ink" className={styles.link} href={whatsappChat(whatsapp.number)}>
      <Icon d={ICONS.whatsapp} size={17} />
      <span>{login.messageUs}</span>
    </TextLink>
  );
}
