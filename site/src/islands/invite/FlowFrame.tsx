// The flows' own frame, /book's and the try-on's (ADR 0265), as the client app frames its booking
// (apps/app/src/booking/steps/shared.tsx). On a phone, in the site header's place, a top bar: the way back where there
// is one, the flow's name, and the way out to the site. On both, over the step, a bar of the flow's steps, those
// reached in navy; on a laptop the way back is a link above it. What the step bar shows is said by the step's own line
// ("Step 2 · Your area"), so the bar is unread.

import { ICONS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { IconButton } from "@maneman/ui/IconButton";
import { StepProgress } from "@maneman/ui/Progress";
import { TextButton, TextLink } from "@maneman/ui/TextLink";
import { header, tryOn } from "../../content/site.ts";
import styles from "./flow-frame.module.css";

/** /book's steps: the name and number, the area, the visit or the list, and the address. */
export const BOOK_STEPS = 4;

/** The phone's top bar, which the site's header gives way to, named for its flow: /book's by default. */
export function FlowTop(props: { onBack: (() => void) | null; title?: string }) {
  return (
    <div class={styles.top}>
      {props.onBack !== null && (
        <IconButton className={styles.topButton} d={ICONS.back} size="md" label={tryOn.back} onClick={props.onBack} />
      )}
      <p class={styles.topTitle}>{props.title ?? header.bookShort}</p>
      <TextLink quiet className={styles.topLink} href="/" aria-label={tryOn.backToSite}>
        <Icon d={ICONS.cross} size="md" />
      </TextLink>
    </div>
  );
}

/**
 * The step bar, with a laptop's way back above it: /book's four steps by default. `at` null: the way back alone, on a
 * screen that stands outside the steps, as the try-on's error.
 */
export function FlowSteps(props: { at: number | null; of?: number; onBack: (() => void) | null }) {
  const { at } = props;
  return (
    <div class={styles.steps}>
      {props.onBack !== null && (
        <TextButton quiet className={styles.back} onClick={props.onBack}>
          <Icon d={ICONS.back} size="sm" />
          {tryOn.back}
        </TextButton>
      )}
      {at !== null && (
        <StepProgress
          className={styles.bar}
          steps={Array.from({ length: props.of ?? BOOK_STEPS }, (_, index) => (index < at ? "done" : "todo"))}
        />
      )}
    </div>
  );
}
