import { ICONS } from "@maneman/brand/icons";
import { gateCopy, tryOn, type Notice } from "../../content/site.ts";
import { formatMobile } from "../../lib/phone.ts";
import { Icon } from "../Drawings.tsx";
import { Title, type HeadingRef } from "./Title.tsx";
import styles from "./TryOn.module.css";

/** Step four: where to send the look on WhatsApp, before it is made. Both fields are needed (ADR 0104). */
export function Gate(props: {
  notice: Notice;
  name: string;
  mobile: string;
  nameBad: boolean;
  mobileBad: boolean;
  failure: string | null;
  sending: boolean;
  heading: HeadingRef;
  onName: (name: string) => void;
  onMobile: (mobile: string) => void;
  onSubmit: (event: Event) => void;
}) {
  const { nameBad, mobileBad, sending } = props;
  const words = gateCopy(props.notice);
  return (
    <div class={styles.gate}>
      <div class={styles.gateImage}>
        <div class={styles.gateFrame}>
          <div class={styles.gateLeft} />
          <div class={styles.gateRight} />
          <span class={`caps ${styles.gateFrameLabel}`}>{tryOn.gate.frame}</span>
        </div>
        <p class={styles.gateCaption}>{words.caption}</p>
      </div>
      <form onSubmit={props.onSubmit} noValidate>
        <Title heading={props.heading}>{words.title}</Title>
        <p class={styles.body}>{words.body}</p>
        <div class={styles.fields}>
          <div>
            <label class={styles.fieldLabel} for="gate-name">
              {tryOn.gate.name}
            </label>
            <input
              id="gate-name"
              class={`${styles.input} ${nameBad ? styles.inputBad : ""}`}
              value={props.name}
              placeholder={tryOn.gate.namePlaceholder}
              autocomplete="name"
              maxLength={60}
              aria-required="true"
              aria-invalid={nameBad}
              aria-describedby={nameBad ? "gate-name-error" : undefined}
              onInput={(event) => {
                props.onName(event.currentTarget.value);
              }}
            />
            <div aria-live="polite">
              {nameBad && (
                <div id="gate-name-error" class={styles.error}>
                  {tryOn.gate.nameError}
                </div>
              )}
            </div>
          </div>
          <div>
            <label class={styles.fieldLabel} for="gate-mobile">
              {tryOn.gate.mobile}
            </label>
            <div class={`${styles.mobile} ${mobileBad ? styles.inputBad : ""}`}>
              <span class={styles.prefix}>+91</span>
              <input
                id="gate-mobile"
                class={styles.mobileInput}
                value={props.mobile}
                placeholder={tryOn.gate.mobilePlaceholder}
                inputMode="numeric"
                autocomplete="tel-national"
                aria-required="true"
                aria-invalid={mobileBad}
                aria-describedby={mobileBad ? "gate-mobile-error" : undefined}
                onInput={(event) => {
                  props.onMobile(formatMobile(event.currentTarget.value));
                }}
              />
            </div>
            <div aria-live="polite">
              {mobileBad && (
                <div id="gate-mobile-error" class={styles.error}>
                  {tryOn.gate.mobileError}
                </div>
              )}
            </div>
          </div>
        </div>
        <div aria-live="polite">
          {props.failure !== null && <div class={`${styles.error} ${styles.gateFailure}`}>{props.failure}</div>}
        </div>
        <button type="submit" class={`btn btn--lg btn--paper ${styles.gateSubmit}`} aria-disabled={sending}>
          {sending && <Icon path={ICONS.sending} size={15} stroke={1.7} />}
          {sending ? tryOn.gate.sending : tryOn.gate.submit}
        </button>
        <div class={styles.reassurance}>{words.reassurance}</div>
      </form>
    </div>
  );
}
