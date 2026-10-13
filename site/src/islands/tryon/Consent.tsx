import { Button } from "@maneman/ui/Button";
import { Checkbox } from "@maneman/ui/Field";
import { TextLink } from "@maneman/ui/TextLink";
import { consentCopy, tryOn, type Notice } from "../../content/site.ts";
import { Title, type HeadingRef } from "./Title.tsx";
import styles from "./TryOn.module.css";

/** Before we begin: how the photograph is used, as the photo notice says, and the agreement to it. */
export function Consent(props: {
  notice: Notice;
  consent: boolean;
  heading: HeadingRef;
  onTick: (consent: boolean) => void;
  onAgree: () => void;
}) {
  const { consent } = props;
  const words = consentCopy(props.notice);
  return (
    <div class={styles.narrow}>
      <Title heading={props.heading}>{words.title}</Title>
      <dl class={styles.rows}>
        {words.rows.map((row) => (
          <div key={row.k} class={styles.row}>
            <dt class={`caps ${styles.rowKey}`}>{row.k}</dt>
            <dd class={styles.rowValue}>{row.v}</dd>
          </div>
        ))}
      </dl>
      <Checkbox
        onInk
        className={styles.agree}
        checked={consent}
        onChange={(event) => {
          props.onTick(event.currentTarget.checked);
        }}
        label={<span class={styles.agreeText}>{words.agreement}</span>}
      />
      <Button variant="light" size="action" className={styles.next} aria-disabled={!consent} onClick={props.onAgree}>
        {tryOn.consent.continue}
      </Button>
      <p class={styles.small}>
        {tryOn.consent.privacy.before}
        <TextLink tone="ink" inline href="/privacy">
          {tryOn.consent.privacy.link}
        </TextLink>
        {tryOn.consent.privacy.after}
      </p>
    </div>
  );
}
