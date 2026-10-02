import { looks, tryOn } from "../../content/site.ts";
import { lookLabel } from "./machine.ts";
import { Title, type HeadingRef } from "./Title.tsx";
import styles from "./TryOn.module.css";

/**
 * Step three: the six looks. Continue goes on to the gate, which asks where to send the look before it is made.
 * Each look shows its picture only when every look has one (`thumbnails`); otherwise its words alone.
 */
export function Looks(props: {
  look: number;
  thumbnails: readonly string[] | null;
  heading: HeadingRef;
  onChoose: (look: number) => void;
  onContinue: () => void;
}) {
  const { look, thumbnails } = props;
  return (
    <div>
      <Title heading={props.heading}>{tryOn.looks.title}</Title>
      <p class={styles.body}>{tryOn.looks.body}</p>
      <fieldset class={`${styles.choices} ${styles.lookGrid}`}>
        <legend class="visually-hidden">{tryOn.looks.title}</legend>
        {looks.map((option, index) => (
          <label key={option.id} class={`${styles.look} ${look === index ? styles.picked : ""}`}>
            <input
              type="radio"
              name="look"
              class="visually-hidden"
              checked={look === index}
              onChange={() => {
                props.onChoose(index);
              }}
            />
            {thumbnails !== null && (
              <span class={styles.thumb}>
                <img class={styles.thumbImage} src={thumbnails[index]} alt="" loading="lazy" decoding="async" />
              </span>
            )}
            <span class={styles.lookText}>
              <span class={styles.lookDensity}>{option.density}</span>
              <span class={styles.lookDetail}>{option.detail}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <button
        type="button"
        class={`${styles.next} ${styles.nextSpaced} ${look >= 0 ? styles.nextOn : styles.nextOff}`}
        aria-disabled={look < 0}
        onClick={props.onContinue}
      >
        {lookLabel(look)}
      </button>
    </div>
  );
}
