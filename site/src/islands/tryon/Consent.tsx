import { capsLook } from "@maneman/ui/Caps";
import { Button } from "@maneman/ui/Button";
import { Checkbox } from "@maneman/ui/Field";
import { TextLink } from "@maneman/ui/TextLink";
import { consentCopy, tryOn, type Notice } from "../../content/site.ts";
import { useState } from "preact/hooks";
import { Title, type HeadingRef } from "./Title.tsx";
import shared from "./TryOn.module.css";
import styles from "./consent.module.css";

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
  // Continue pressed before the box is ticked says why it did nothing.
  const [askedFirst, setAskedFirst] = useState(false);
  return (
    <div class={styles.narrow}>
      <Title heading={props.heading}>{words.title}</Title>
      <dl class={styles.rows}>
        {words.rows.map((row) => (
          <div key={row.label} class={styles.row}>
            <dt class={capsLook(styles.rowKey)}>{row.label}</dt>
            <dd class={styles.rowValue}>{row.says}</dd>
          </div>
        ))}
      </dl>
      <Checkbox
        onInk
        className={styles.agree}
        checked={consent}
        onChange={(event) => {
          setAskedFirst(false);
          props.onTick(event.currentTarget.checked);
        }}
        label={<span class={styles.agreeText}>{words.agreement}</span>}
      />
      <Button
        variant="light"
        size="action"
        className={shared.next}
        aria-disabled={!consent}
        onClick={() => {
          if (consent) props.onAgree();
          else setAskedFirst(true);
        }}
      >
        {tryOn.consent.continue}
      </Button>
      <p class={styles.small} aria-live="polite">
        {askedFirst && !consent ? tryOn.consent.tickFirst : ""}
      </p>
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
