// The terms a page binds the visitor to, and the privacy notice, each a link: "Our Terms and Privacy Notice apply."
// Beneath a form's agreement it sits under the box's words; `alone`, on a flow's screen with no agreement of its own,
// where no footer carries the links, it takes the screen's own place: every screen of /book, the referral landing and
// the try-on links both. `onInk`: on the booked screen's navy.

import { TextLink } from "@maneman/ui/TextLink";
import { referral } from "../content/referral.ts";
import styles from "./LegalLinks.module.css";

export function LegalLinks(props: { alone?: string | undefined; onInk?: boolean }) {
  const words = referral.form.legal;
  return (
    <p
      class={[
        styles.legal,
        props.alone === undefined ? undefined : styles.alone,
        props.alone,
        props.onInk === true ? styles.onInk : undefined,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {words.before}
      <TextLink inline tone={props.onInk === true ? "ink" : "plain"} href="/terms">
        {words.terms}
      </TextLink>
      {words.between}
      <TextLink inline tone={props.onInk === true ? "ink" : "plain"} href="/privacy">
        {words.privacy}
      </TextLink>
      {words.after}
    </p>
  );
}
