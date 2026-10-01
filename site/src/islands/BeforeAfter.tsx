// The before/after comparison: drag the handle, or use the arrow keys, to
// reveal more of one image. A native range input does the work, so it is
// keyboard-operable and announced as a slider.
//
// The position reaches CSS as --position. The starting value comes from a
// class, so the server-rendered HTML carries no inline style.

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { ICONS } from "@maneman/brand/icons";
import { fill } from "../lib/text.ts";
import styles from "./BeforeAfter.module.css";

interface Props {
  /** The two images, named slots from the Astro page. */
  before?: ComponentChildren;
  after?: ComponentChildren;
  /** Where the handle starts, as v2's teaser draws it. */
  start: 46;
  beforeLabel: string;
  afterLabel: string;
  sliderLabel: string;
  /** What a screen reader hears as the handle moves: "{before}% before, {after}% after". */
  sliderValue: string;
  /** The design's "Placeholder" tag, when this pair is placeholder material. */
  tag?: string | undefined;
}

export default function BeforeAfter(props: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<number>(props.start);

  useEffect(() => {
    frame.current?.style.setProperty("--position", `${String(position)}%`);
  }, [position]);

  return (
    <div ref={frame} class={`${styles.frame} ${styles.teaser} ${styles.from46}`}>
      <div class={styles.layer}>{props.after}</div>
      <div class={`${styles.layer} ${styles.before}`}>{props.before}</div>
      <span class={`label ${styles.corner} ${styles.left}`}>{props.beforeLabel}</span>
      <span class={`label ${styles.corner} ${styles.right}`}>{props.afterLabel}</span>
      {props.tag !== undefined && <span class={`label ${styles.tag}`}>{props.tag}</span>}
      <div class={styles.line} />
      <div class={styles.handle}>
        {[ICONS.handleLeft, ICONS.handleRight].map((path) => (
          <svg
            key={path}
            viewBox="0 0 24 24"
            width={15}
            height={15}
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d={path} />
          </svg>
        ))}
      </div>
      <input
        class={styles.input}
        type="range"
        min={0}
        max={100}
        value={position}
        aria-label={props.sliderLabel}
        aria-valuetext={fill(props.sliderValue, { before: String(position), after: String(100 - position) })}
        onInput={(event) => {
          setPosition(Number(event.currentTarget.value));
        }}
      />
    </div>
  );
}
