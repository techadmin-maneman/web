import { ICONS } from "@maneman/brand/icons";
import { tryOn } from "../../content/site.ts";
import { formatMobile } from "../../lib/phone.ts";
import { Icon } from "../Drawings.tsx";
import { Title, type HeadingRef } from "./Title.tsx";
import styles from "./TryOn.module.css";

/** Step five: the result is ready. The name and number are optional, as the copy says. */
export function Gate(props: {
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
  return (
    <div class={styles.gate}>
      <div class={styles.gateImage}>
        <div class={styles.gateFrame}>
          <div class={styles.gateLeft} />
          <div class={styles.gateRight} />
          <span class={`caps ${styles.gateReady}`}>{tryOn.gate.ready}</span>
        </div>
        <p class={styles.gateCaption}>{tryOn.gate.caption}</p>
      </div>
      <form onSubmit={props.onSubmit} noValidate>
        <Title heading={props.heading}>{tryOn.gate.title}</Title>
        <p class={styles.body}>{tryOn.gate.body}</p>
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
        <div class={styles.reassurance}>{tryOn.gate.reassurance}</div>
      </form>
    </div>
  );
}
