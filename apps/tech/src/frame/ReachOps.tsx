// The way to ops from anywhere the app tells the technician to ask them: a call, or a WhatsApp, to ops' own phone.

import { ButtonLink } from "@maneman/ui/Button";
import { OPS_NUMBER, whatsappChat } from "@maneman/web-kit/whatsapp";
import { ops as copy } from "../content.ts";
import { classes } from "@maneman/ui/classes";
import styles from "./reach-ops.module.css";

export function ReachOps({ className, onPaper = false }: { readonly className?: string; readonly onPaper?: boolean }) {
  // On paper the new look's control is a thumb's 44 px; ops is reached at the action's height.
  const variant = onPaper ? "outline" : "outlineOnInk";
  const size = onPaper ? "action" : "control";
  return (
    <div className={classes(styles.reach, className)}>
      <ButtonLink variant={variant} size={size} href={`tel:+${OPS_NUMBER}`}>
        {copy.call}
      </ButtonLink>
      <ButtonLink
        variant={variant}
        size={size}
        href={whatsappChat(OPS_NUMBER)}
        target="_blank"
        rel="noopener noreferrer"
      >
        {copy.whatsApp}
      </ButtonLink>
    </div>
  );
}
