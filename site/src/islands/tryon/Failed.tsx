import { capsLook } from "@maneman/ui/Caps";
import { Button, ButtonLink } from "@maneman/ui/Button";
import { ICONS } from "@maneman/brand/icons";
import { tryOn } from "../../content/site.ts";
import type { ErrorKind } from "../../lib/tryon-errors.ts";
import { Icon } from "@maneman/ui/Icon";
import { Title, type HeadingRef } from "./Title.tsx";
import styles from "./TryOn.module.css";

/** The error screen: the design's for a photograph that cannot be used, and the same frame for the other kinds. */
export function Failed(props: { kind: ErrorKind; heading: HeadingRef; onAgain: () => void }) {
  const copy = tryOn.error.kinds[props.kind];
  return (
    <div class={styles.notice}>
      <div class={styles.noticeFrame}>
        <Icon d={ICONS.noPhoto} size="xl" />
        <div class={capsLook()}>{copy.frame}</div>
      </div>
      <Title heading={props.heading} className={styles.noticeTitle}>
        {copy.title}
      </Title>
      <p class={styles.noticeBody}>{copy.body}</p>
      <div class={styles.noticeActions}>
        {/* While the try-on cannot run, another photograph would be refused too. */}
        {props.kind !== "unavailable" && props.kind !== "paused" && (
          <Button variant="light" size="action" onClick={props.onAgain}>
            {tryOn.error.another}
          </Button>
        )}
        <ButtonLink variant="outlineOnInk" size="action" href="/book">
          {tryOn.error.book}
        </ButtonLink>
      </div>
    </div>
  );
}
