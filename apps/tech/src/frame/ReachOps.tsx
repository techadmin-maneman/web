// The way to ops from anywhere the app tells the technician to ask them: a call to ops' phone, or a WhatsApp to it, which
// arrives in the console's Care inbox. On paper each carries its icon, as the prototype draws them.

import { GLYPHS } from "@maneman/brand/icons";
import { ButtonLink } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
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
        {onPaper && <Icon d={GLYPHS.phone} size="sm" />}
        <span>{copy.call}</span>
      </ButtonLink>
      <ButtonLink
        variant={variant}
        size={size}
        href={whatsappChat(OPS_NUMBER)}
        target="_blank"
        rel="noopener noreferrer"
      >
        {onPaper && <Icon d={GLYPHS.bubble} size="sm" />}
        <span>{copy.whatsApp}</span>
      </ButtonLink>
    </div>
  );
}
