import { ICONS } from "@maneman/brand/icons";
import { consentCopy, tryOn, type Notice } from "../../content/site.ts";
import { Icon } from "../Drawings.tsx";
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
      <label class={styles.agree}>
        <input
          type="checkbox"
          class="visually-hidden"
          checked={consent}
          onChange={(event) => {
            props.onTick(event.currentTarget.checked);
          }}
        />
        <span class={`${styles.box} ${consent ? styles.boxOn : ""}`} aria-hidden="true">
          {consent && <Icon path={ICONS.tick} size={14} stroke={1.7} />}
        </span>
        <span>{words.agreement}</span>
      </label>
      <button
        type="button"
        class={`${styles.next} ${consent ? styles.nextOn : styles.nextOff}`}
        aria-disabled={!consent}
        onClick={props.onAgree}
      >
        {tryOn.consent.continue}
      </button>
      <p class={styles.small}>
        {tryOn.consent.privacy.before}
        <a class={styles.inlineLink} href="/privacy">
          {tryOn.consent.privacy.link}
        </a>
        {tryOn.consent.privacy.after}
      </p>
    </div>
  );
}
