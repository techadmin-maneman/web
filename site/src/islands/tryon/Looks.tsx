import { Button } from "@maneman/ui/Button";
import { ChoiceCard } from "@maneman/ui/ChoiceCard";
import { Fieldset } from "@maneman/ui/Field";
import { looks, tryOn } from "../../content/site.ts";
import { lookLabel } from "./machine.ts";
import { Title, type HeadingRef } from "./Title.tsx";
import shared from "./TryOn.module.css";
import styles from "./looks.module.css";

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
      <p class={shared.body}>{tryOn.looks.body}</p>
      <Fieldset legend={tryOn.looks.title} legendLook="hidden" className={styles.lookGrid}>
        {looks.map((option, index) => (
          <ChoiceCard
            key={option.id}
            name="look"
            look="picture"
            onInk
            checked={look === index}
            onChange={() => {
              props.onChoose(index);
            }}
          >
            <>
              {thumbnails !== null && (
                <span class={styles.thumb}>
                  <img class={styles.thumbImage} src={thumbnails[index]} alt="" loading="lazy" decoding="async" />
                </span>
              )}
              <span class={styles.lookText}>
                <span class={styles.lookName}>{option.name}</span>
                {option.detail !== "" && <span class={styles.lookDetail}>{option.detail}</span>}
              </span>
            </>
          </ChoiceCard>
        ))}
      </Fieldset>
      <Button
        variant="light"
        size="action"
        className={`${shared.next} ${shared.nextSpaced}`}
        aria-disabled={look < 0}
        onClick={props.onContinue}
      >
        {lookLabel(look)}
      </Button>
    </div>
  );
}
