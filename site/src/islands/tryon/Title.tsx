import type { ComponentChildren } from "preact";
import styles from "./TryOn.module.css";

export type HeadingRef = { current: HTMLHeadingElement | null };

/** A screen's heading. The island focuses it when the screen opens, so a screen reader starts there. */
export function Title(props: { heading: HeadingRef; className?: string | undefined; children: ComponentChildren }) {
  return (
    <h1 ref={props.heading} tabIndex={-1} class={props.className ?? styles.title}>
      {props.children}
    </h1>
  );
}
