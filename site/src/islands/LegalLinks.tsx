// The terms a page binds the visitor to, and the privacy notice, each a link: "Our Terms and Privacy Notice apply."
// Beneath a form's agreement it sits under the box's words; `alone`, on a flow's screen that asks nothing yet, where
// no footer carries the links, it takes the screen's own place (the referral landing's first screen, the try-on's).

import { TextLink } from "@maneman/ui/TextLink";
import { referral } from "../content/referral.ts";
import styles from "./LegalLinks.module.css";

export function LegalLinks(props: { alone?: string | undefined }) {
  const words = referral.form.legal;
  return (
    <p class={props.alone === undefined ? styles.legal : `${styles.legal ?? ""} ${styles.alone ?? ""} ${props.alone}`}>
      {words.before}
      <TextLink inline href="/terms">
        {words.terms}
      </TextLink>
      {words.between}
      <TextLink inline href="/privacy">
        {words.privacy}
      </TextLink>
      {words.after}
    </p>
  );
}
