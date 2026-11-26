// The way to ops from anywhere the app tells the technician to ask them: a call to ops' phone, or a WhatsApp to it, which
// arrives in the console's Care inbox. On paper each carries its icon, as the prototype draws them; where ops are the
// screen's one ask, under a title that names them, as Me's Contact sheet, the call is filled and each says its way alone.

import { BRAND_MARKS, GLYPHS } from "@maneman/brand/icons";
import { ButtonLink } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { OPS_NUMBER, whatsappChat } from "@maneman/web-kit/whatsapp";
import { ops as copy } from "../content.ts";
import { classes } from "@maneman/ui/classes";
import styles from "./reach-ops.module.css";

export function ReachOps({
  className,
  onPaper = false,
  named = false,
}: {
  readonly className?: string;
  readonly onPaper?: boolean;
  /** Under a title that names ops (on paper): the call filled, and "Call" and "WhatsApp" alone. */
  readonly named?: boolean;
}) {
  // On paper the new look's control is a thumb's 44 px; ops is reached at the action's height.
  const variant = onPaper ? "outline" : "outlineOnInk";
  const size = onPaper ? "action" : "control";
  const asOne = onPaper && named;
  return (
    <div className={classes(styles.reach, className)}>
      <ButtonLink variant={asOne ? "primary" : variant} size={size} href={`tel:+${OPS_NUMBER}`}>
        {onPaper && <Icon d={GLYPHS.phone} size="sm" />}
        <span>{asOne ? copy.callShort : copy.call}</span>
      </ButtonLink>
      <ButtonLink
        variant={variant}
        size={size}
        href={whatsappChat(OPS_NUMBER)}
        target="_blank"
        rel="noopener noreferrer"
      >
        {onPaper && <Icon d={BRAND_MARKS.whatsapp} size="sm" />}
        <span>{asOne ? copy.whatsAppShort : copy.whatsApp}</span>
      </ButtonLink>
    </div>
  );
}
