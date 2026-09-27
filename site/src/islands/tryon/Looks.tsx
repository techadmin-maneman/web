import { looks, tryOn } from "../../content/site.ts";
import { lookLabel } from "./machine.ts";
import { Title, type HeadingRef } from "./Title.tsx";
import styles from "./TryOn.module.css";

/** Step three: the six looks. Once a render has started, only its look shows as chosen (ADR 0022, 24). */
export function Looks(props: {
  look: number;
  fixed: boolean;
  heading: HeadingRef;
  onChoose: (look: number) => void;
  onGenerate: () => void;
}) {
  const { look, fixed } = props;
  return (
    <div>
      <Title heading={props.heading}>{tryOn.looks.title}</Title>
      <p class={styles.body}>{fixed ? tryOn.looks.fixed : tryOn.looks.body}</p>
      <fieldset class={`${styles.choices} ${styles.lookGrid}`}>
        <legend class="visually-hidden">{tryOn.looks.title}</legend>
        {looks.map((option, index) => (
          <label
            key={option.id}
            class={`${styles.look} ${look === index ? styles.picked : ""} ${fixed && look !== index ? styles.lookOff : ""}`}
          >
            <input
              type="radio"
              name="look"
              class="visually-hidden"
              checked={look === index}
              disabled={fixed && look !== index}
              onChange={() => {
                props.onChoose(index);
              }}
            />
            <span class={styles.thumb}>
              <span class={styles.thumbLabel}>{tryOn.looks.preview}</span>
            </span>
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
        onClick={props.onGenerate}
      >
        {lookLabel(look, fixed)}
      </button>
    </div>
  );
}
