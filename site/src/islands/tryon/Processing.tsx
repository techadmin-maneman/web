import { useEffect } from "preact/hooks";
import { ICONS } from "@maneman/brand/icons";
import { tryOn } from "../../content/site.ts";
import { Icon } from "../Drawings.tsx";
import { useCountdown } from "./hooks.ts";
import { Title, type HeadingRef } from "./Title.tsx";
import styles from "./TryOn.module.css";

/** Step four: v2's countdown, which is only shown: the gate opens after it, whether or not the render has finished. */
export function Processing(props: { heading: HeadingRef; onDone: () => void }) {
  const { seconds, steps } = tryOn.processing;
  const elapsed = useCountdown(seconds);
  useEffect(() => {
    if (elapsed >= seconds) props.onDone();
  }, [elapsed]);

  return (
    <div class={styles.processing}>
      <Title heading={props.heading}>{tryOn.processing.title}</Title>
      <ul class={styles.ticks}>
        {steps.map((step) => (
          <li key={step.label} class={`${styles.tick} ${elapsed >= step.at ? styles.tickDone : ""}`}>
            <Icon path={ICONS.tick} size={18} stroke={1.7} />
            <span>{step.label}</span>
          </li>
        ))}
      </ul>
      {/* Seconds tick visually; screen readers hear only each finished step. */}
      <div class={styles.countdown} aria-hidden="true" data-countdown>
        {`${String(Math.max(0, seconds - elapsed))}s`}
      </div>
      <p class="visually-hidden" role="status">
        {steps.filter((step) => elapsed >= step.at).at(-1)?.label ?? ""}
      </p>
    </div>
  );
}
