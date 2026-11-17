// The results beneath the hero: one client's before and after at a time, large, on the shared compare. On a laptop the
// section's heading, and beneath it the pair's line, where it stands among the rest and the arrows to the next, stand
// beside it; on a phone the heading comes first and the rest beneath the picture (ADR 0263). The page draws no swipe of its own, since a
// drag on the picture moves the compare's divider. A pair made by AI says so on the picture.

import "./refs-as-props.ts";
import { GLYPHS, ICONS } from "@maneman/brand/icons";
import { IconButton } from "@maneman/ui/IconButton";
import { useState } from "preact/hooks";
import { illustrationTag, results, tryOnTeaser } from "../content/site.ts";
import { fill } from "../lib/text.ts";
import BeforeAfter from "./BeforeAfter.tsx";
import styles from "./ResultsGallery.module.css";

interface ShownPicture {
  readonly src: string;
  readonly srcset: string;
  readonly sizes: string;
  readonly alt: string;
}

/** A pair's picture, fetched only as the results come near, so the hero's film loads first. */
function Shown({ picture }: { picture: ShownPicture }) {
  return (
    <img
      src={picture.src}
      srcset={picture.srcset}
      sizes={picture.sizes}
      alt={picture.alt}
      loading="lazy"
      decoding="async"
    />
  );
}

export interface ShownPair {
  readonly before: ShownPicture;
  readonly after: ShownPicture;
  readonly caption: string;
  readonly illustration: boolean;
}

export default function ResultsGallery(props: { title: string; pairs: readonly ShownPair[] }) {
  const [at, setAt] = useState(0);
  // The divider leans once on the first pair, to say it moves; not again on each one stepped to.
  const [stepped, setStepped] = useState(false);
  const count = props.pairs.length;
  const pair = props.pairs[at];
  if (pair === undefined) return null;
  const go = (step: number) => {
    setStepped(true);
    setAt((current) => (current + step + count) % count);
  };

  return (
    <div class={styles.gallery}>
      <h2 class={`section-title ${styles.title ?? ""}`}>{props.title}</h2>
      <div class={styles.picture}>
        <BeforeAfter
          key={at}
          className={styles.compare}
          start={tryOnTeaser.start_percent}
          lean={!stepped}
          beforeLabel={results.before}
          afterLabel={results.after}
          sliderLabel={results.sliderLabel}
          sliderValue={tryOnTeaser.sliderValue}
          tag={pair.illustration ? illustrationTag : undefined}
          before={<Shown picture={pair.before} />}
          after={<Shown picture={pair.after} />}
        />
      </div>
      <div class={styles.controls}>
        <div class={styles.words}>
          <p class={styles.caption} aria-live="polite">
            {pair.caption}
          </p>
          <p class={styles.count}>{fill(results.count, { at: String(at + 1), count: String(count) })}</p>
        </div>
        <div class={styles.arrows}>
          <IconButton
            d={ICONS.back}
            size="md"
            edged
            label={results.previous}
            className={styles.arrow}
            onClick={() => {
              go(-1);
            }}
          />
          <IconButton
            d={GLYPHS.chevron}
            size="md"
            edged
            label={results.next}
            className={styles.arrow}
            onClick={() => {
              go(1);
            }}
          />
        </div>
      </div>
    </div>
  );
}
