import { ICONS } from "@maneman/brand/icons";
import { tryOn } from "../../content/site.ts";
import type { ErrorKind } from "../../lib/tryon-errors.ts";
import { Icon } from "../Drawings.tsx";
import { Title, type HeadingRef } from "./Title.tsx";
import styles from "./TryOn.module.css";

/** The error screen: v2's for a photograph that cannot be used, and the same frame for the other kinds. */
export function Failed(props: { kind: ErrorKind; heading: HeadingRef; onAgain: () => void }) {
  const copy = tryOn.error.kinds[props.kind];
  return (
    <div class={styles.notice}>
      <div class={styles.noticeFrame}>
        <Icon path={ICONS.noPhoto} size={28} stroke={1.5} />
        <div class="caps">{copy.frame}</div>
      </div>
      <Title heading={props.heading} className={styles.noticeTitle}>
        {copy.title}
      </Title>
      <p class={styles.noticeBody}>{copy.body}</p>
      <div class={styles.noticeActions}>
        {/* While the try-on cannot run, another photograph would be refused too. */}
        {props.kind !== "unavailable" && (
          <button type="button" class="btn btn--lg btn--paper" onClick={props.onAgain}>
            {tryOn.error.another}
          </button>
        )}
        <a class="btn btn--lg btn--line-on-ink" href="/book">
          {tryOn.error.book}
        </a>
      </div>
    </div>
  );
}
