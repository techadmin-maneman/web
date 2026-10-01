import { ICONS } from "@maneman/brand/icons";
import { tryOn } from "../../content/site.ts";
import { Icon } from "../Drawings.tsx";
import { Title, type HeadingRef } from "./Title.tsx";
import styles from "./TryOn.module.css";

/**
 * After the gate: the look is on its way to WhatsApp, and never shown here (ADR 0104). A visitor back after their
 * look is told it was sent, without the number, which the page does not know.
 */
export function Sent(props: { mobile: string; returning: boolean; heading: HeadingRef }) {
  const { sent } = tryOn;
  return (
    <div class={styles.notice}>
      <div class={styles.noticeFrame}>
        <Icon path={ICONS.whatsapp} size={28} stroke={1.5} />
        <div class="caps">{sent.frame}</div>
      </div>
      <Title heading={props.heading} className={styles.noticeTitle}>
        {props.returning ? sent.returning.title : sent.title}
      </Title>
      {props.returning ? (
        <p class={styles.noticeBody}>{sent.returning.body}</p>
      ) : (
        <p class={styles.noticeBody}>
          {sent.to.before}
          <span class={styles.number}>{`+91 ${props.mobile}`}</span>
          {`${sent.to.after} ${sent.privacy}`}
        </p>
      )}
      <div class={styles.disclaimer}>{sent.disclaimer}</div>
      <div class={styles.noticeActions}>
        <a class="btn btn--lg btn--paper" href="/book">
          {sent.book}
        </a>
        <a class="btn btn--lg btn--line-on-ink" href="/">
          {sent.home}
        </a>
      </div>
    </div>
  );
}
