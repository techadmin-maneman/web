// The results beneath the hero: one client's before and after at a time, large, on the shared compare, its line and
// where it stands among the rest beside it, and the arrows to the next. The page draws no swipe of its own, since a
// drag on the picture moves the compare's divider. A pair made by AI says so on the picture.

import "./refs-as-props.ts";
import { capsLook } from "@maneman/ui/Caps";
import { ICONS } from "@maneman/brand/icons";
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

export default function ResultsGallery(props: { pairs: readonly ShownPair[] }) {
  const [at, setAt] = useState(0);
  const count = props.pairs.length;
  const pair = props.pairs[at];
  if (pair === undefined) return null;
  const go = (step: number) => {
    setAt((current) => (current + step + count) % count);
  };

  return (
    <div class={styles.gallery}>
      <div class={styles.picture}>
        <BeforeAfter
          key={at}
          className={styles.compare}
          start={tryOnTeaser.start_percent}
          beforeLabel={results.before}
          afterLabel={results.after}
          sliderLabel={results.sliderLabel}
          sliderValue={tryOnTeaser.sliderValue}
          tag={pair.illustration ? illustrationTag : undefined}
          before={<Shown picture={pair.before} />}
          after={<Shown picture={pair.after} />}
        />
      </div>
      <div class={styles.words}>
        <p class={styles.caption} aria-live="polite">
          {pair.caption}
        </p>
        <div class={styles.controls}>
          <p class={capsLook(styles.count)}>{fill(results.count, { at: String(at + 1), count: String(count) })}</p>
          <div class={styles.arrows}>
            <IconButton
              d={ICONS.handleLeft}
              size="md"
              edged
              label={results.previous}
              className={styles.arrow}
              onClick={() => {
                go(-1);
              }}
            />
            <IconButton
              d={ICONS.handleRight}
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
    </div>
  );
}
