import { Button, ButtonLink } from "@maneman/ui/Button";
import { tryOn } from "../../content/site.ts";
import type { ErrorKind } from "../../lib/tryon-errors.ts";
import { Title, type HeadingRef } from "./Title.tsx";
import styles from "./TryOn.module.css";

/** The error screen: the design's for a photograph that cannot be used, and the same frame for the other kinds. */
export function Failed(props: { kind: ErrorKind; heading: HeadingRef; onAgain: () => void }) {
  const copy = tryOn.error.kinds[props.kind];
  // While the try-on cannot run, another photograph would be refused too: booking is the one way on, filled.
  const another = props.kind !== "unavailable" && props.kind !== "paused";
  return (
    <div>
      <Title heading={props.heading} className={styles.noticeTitle}>
        {copy.title}
      </Title>
      <p class={styles.noticeBody}>{copy.body}</p>
      <div class={styles.foot}>
        {another && (
          <Button variant="primary" size="action" onClick={props.onAgain}>
            {tryOn.error.another}
          </Button>
        )}
        <ButtonLink variant={another ? "outline" : "primary"} size="action" href="/book">
          {tryOn.error.book}
        </ButtonLink>
      </div>
    </div>
  );
}
