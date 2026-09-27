import { stageOptions, tryOn } from "../../content/site.ts";
import { StageDrawing } from "../Drawings.tsx";
import { Title, type HeadingRef } from "./Title.tsx";
import styles from "./TryOn.module.css";

/** Step two: where the hair loss is. */
export function Stage(props: {
  stage: number;
  heading: HeadingRef;
  onChoose: (stage: number) => void;
  onDone: () => void;
}) {
  return (
    <div class={styles.medium}>
      <Title heading={props.heading}>{tryOn.stage.title}</Title>
      <p class={styles.body}>{tryOn.stage.body}</p>
      <fieldset class={`${styles.choices} ${styles.stageGrid}`}>
        <legend class="visually-hidden">{tryOn.stage.title}</legend>
        {stageOptions.map((option, index) => (
          <label key={option.id} class={`${styles.stage} ${props.stage === index ? styles.picked : ""}`}>
            <input
              type="radio"
              name="stage"
              class="visually-hidden"
              checked={props.stage === index}
              onChange={() => {
                props.onChoose(index);
              }}
            />
            <StageDrawing hair={option.hair} zone={option.zone} size="large" />
            <span>
              <span class={styles.stageTitle}>{option.title}</span>
              <span class={styles.stageSub}>{option.sub}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <button type="button" class={`${styles.next} ${styles.nextOn} ${styles.nextSpaced}`} onClick={props.onDone}>
        {tryOn.stage.continue}
      </button>
    </div>
  );
}
