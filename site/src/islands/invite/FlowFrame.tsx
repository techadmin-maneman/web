// The booking pages' own frame (ADR 0265), as the client app frames its booking (apps/app/src/booking/steps/shared.tsx).
// On a phone, in the site header's place, a top bar: the way back where there is one, the flow's name, and the way out
// to the site. On both, over the step, a bar of /book's four steps, those reached in navy; on a laptop the way back is
// a link above it. What the step bar shows is said by the step's own line ("Step 2 · Your area"), so the bar is unread.

import { ICONS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { IconButton, iconButtonLook } from "@maneman/ui/IconButton";
import { StepProgress } from "@maneman/ui/Progress";
import { textLinkLook } from "@maneman/ui/TextLink";
import { header, tryOn } from "../../content/site.ts";
import styles from "./flow-frame.module.css";

/** /book's steps: the name and number, the area, the visit or the list, and the address. */
export const BOOK_STEPS = 4;

/** The phone's top bar, which the site's header gives way to. */
export function FlowTop(props: { onBack: (() => void) | null }) {
  return (
    <div class={styles.top}>
      {props.onBack !== null && (
        <IconButton className={styles.topButton} d={ICONS.back} size="md" label={tryOn.back} onClick={props.onBack} />
      )}
      <p class={styles.topTitle}>{header.bookShort}</p>
      <a class={iconButtonLook(styles.topButton)} href="/" aria-label={tryOn.backToSite}>
        <Icon d={ICONS.cross} size="md" />
      </a>
    </div>
  );
}

/** The step bar, with a laptop's way back above it. */
export function FlowSteps(props: { at: number; onBack: (() => void) | null }) {
  return (
    <div class={styles.steps}>
      {props.onBack !== null && (
        <button type="button" class={textLinkLook({ quiet: true, className: styles.back })} onClick={props.onBack}>
          <Icon d={ICONS.back} size="sm" />
          {tryOn.back}
        </button>
      )}
      <StepProgress
        className={styles.bar}
        steps={Array.from({ length: BOOK_STEPS }, (_, index) => (index < props.at ? "done" : "todo"))}
      />
    </div>
  );
}
