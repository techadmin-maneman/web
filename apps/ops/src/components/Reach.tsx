// A queue row's ways to the person it is about: a WhatsApp chat and a call, on the number the row names. Ops answer a
// grievance or check a request "on the number shown", so the number is a link rather than text to copy.

import { TextLink } from "@maneman/ui/TextLink";
import { whatsappChat } from "@maneman/web-kit/whatsapp";
import { clients } from "../content.ts";
import { phoneWords } from "../lib/phone.ts";
import styles from "./reach.module.css";

export function Reach({ name, mobile }: { name: string; mobile: string }) {
  const words = phoneWords(mobile);
  return (
    <p className={styles.reach}>
      <TextLink href={whatsappChat(mobile)} newTab aria-label={clients.whatsappLabel(name)}>
        {clients.whatsapp}
      </TextLink>
      <TextLink href={`tel:${mobile}`} aria-label={clients.callLabel(name, words)}>
        {words}
      </TextLink>
    </p>
  );
}
