// The founder's note (ADR 0263): its first paragraph, then the rest folded behind "Read the full note", in the
// browser's own details and summary, so it opens with no script and every word is in the page as written.

import { Disclosure } from "@maneman/ui/Disclosure";
import styles from "./FounderNote.module.css";

export default function FounderNote(props: { paragraphs: readonly string[]; more: string }) {
  const [first, ...rest] = props.paragraphs;
  return (
    <div>
      {first !== undefined && <p class={`body-text ${styles.paragraph ?? ""}`}>{first}</p>}
      {rest.length > 0 && (
        <Disclosure summary={props.more} className={styles.more} summaryClassName={styles.summary}>
          {rest.map((paragraph) => (
            <p class={`body-text ${styles.paragraph ?? ""}`} key={paragraph}>
              {paragraph}
            </p>
          ))}
        </Disclosure>
      )}
    </div>
  );
}
