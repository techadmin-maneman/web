import { capsLook } from "@maneman/ui/Caps";
import { ButtonLink } from "@maneman/ui/Button";
import { ICONS } from "@maneman/brand/icons";
import { tryOn } from "../../content/site.ts";
import { Icon } from "@maneman/ui/Icon";
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
        <Icon d={ICONS.whatsapp} size="xl" />
        <div class={capsLook()}>{sent.frame}</div>
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
        <ButtonLink variant="light" size="action" href="/book">
          {sent.book}
        </ButtonLink>
        <ButtonLink variant="outlineOnInk" size="action" href="/">
          {sent.home}
        </ButtonLink>
      </div>
    </div>
  );
}
