// The way to ops from anywhere the app tells the technician to ask them: a call, or a WhatsApp, to ops' own phone.

import { ButtonLink } from "@maneman/ui/Button";
import { OPS_NUMBER, whatsappChat } from "@maneman/web-kit/whatsapp";
import { ops as copy } from "../content.ts";
import { classes } from "@maneman/ui/classes";
import styles from "./reach-ops.module.css";

export function ReachOps({ className }: { readonly className?: string }) {
  return (
    <div className={classes(styles.reach, className)}>
      <ButtonLink variant="outlineOnInk" size="control" href={`tel:+${OPS_NUMBER}`}>
        {copy.call}
      </ButtonLink>
      <ButtonLink
        variant="outlineOnInk"
        size="control"
        href={whatsappChat(OPS_NUMBER)}
        target="_blank"
        rel="noopener noreferrer"
      >
        {copy.whatsApp}
      </ButtonLink>
    </div>
  );
}
