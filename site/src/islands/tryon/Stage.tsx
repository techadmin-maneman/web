import { Button } from "@maneman/ui/Button";
import { ChoiceCard } from "@maneman/ui/ChoiceCard";
import { Fieldset } from "@maneman/ui/Field";
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
      <Fieldset legend={tryOn.stage.title} legendLook="hidden" className={styles.stageGrid}>
        {stageOptions.map((option, index) => (
          <ChoiceCard
            key={option.id}
            name="stage"
            look="picture"
            onInk
            className={styles.stage}
            checked={props.stage === index}
            onChange={() => {
              props.onChoose(index);
            }}
          >
            <>
              <StageDrawing hair={option.hair} zone={option.zone} size="large" />
              <span>
                <span class={styles.stageTitle}>{option.title}</span>
                <span class={styles.stageSub}>{option.sub}</span>
              </span>
            </>
          </ChoiceCard>
        ))}
      </Fieldset>
      <Button variant="light" size="action" className={`${styles.next} ${styles.nextSpaced}`} onClick={props.onDone}>
        {tryOn.stage.continue}
      </Button>
    </div>
  );
}
