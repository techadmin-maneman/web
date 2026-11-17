// A phone's Norwood scale (ADR 0263): the five stages we fit as a choice above two pictures, the stage chosen and the
// restored hairline beside it. Choosing a stage changes only its own picture. Without scripts the first stage shows.

import "../refs-as-props.ts";
import { Segmented } from "@maneman/ui/Segmented";
import { useState } from "preact/hooks";
import { illustrationTag, norwood } from "../../content/site.ts";
import { fill } from "../../lib/text.ts";
import styles from "./NorwoodPicker.module.css";

export interface PickerPicture {
  readonly src: string;
  readonly srcset: string;
  readonly sizes: string;
  readonly alt: string;
}

export interface PickerStage {
  readonly numeral: string;
  readonly name: string;
  readonly tag: string;
  readonly picture: PickerPicture;
}

function Picture({ picture }: { picture: PickerPicture }) {
  return (
    <img
      class={styles.image}
      src={picture.src}
      srcset={picture.srcset}
      sizes={picture.sizes}
      alt={picture.alt}
      loading="lazy"
      decoding="async"
    />
  );
}

export default function NorwoodPicker(props: { stages: readonly PickerStage[]; restored: PickerPicture | null }) {
  const [at, setAt] = useState("0");
  const stage = props.stages[Number(at)] ?? props.stages[0];
  if (stage === undefined) return null;
  const names = Object.fromEntries(
    props.stages.map((each, index) => [
      String(index),
      fill(norwood.pickerOption, { numeral: each.numeral, name: each.name }),
    ]),
  );

  return (
    <div class={styles.picker}>
      <Segmented
        pressed
        label={norwood.picker}
        options={props.stages.map((each, index) => [String(index), each.numeral] as const)}
        names={names}
        value={at}
        onChange={setAt}
      />
      <div class={styles.tiles}>
        <figure class={styles.tile}>
          <div class={styles.frame}>
            <Picture picture={stage.picture} />
            <span class={`label ${styles.numeral ?? ""}`}>{stage.numeral}</span>
          </div>
          <figcaption class={styles.caption}>
            <span class={styles.name}>{stage.name}</span>
            <span class={styles.sub}>{stage.tag}</span>
          </figcaption>
        </figure>
        {props.restored !== null && (
          <figure class={styles.tile}>
            <div class={`${styles.frame ?? ""} ${styles.restored ?? ""}`}>
              <Picture picture={props.restored} />
              <span class={`label ${styles.after ?? ""}`}>{norwood.after}</span>
              <span class={styles.illustration}>{illustrationTag}</span>
            </div>
            <figcaption class={`${styles.caption ?? ""} ${styles.name ?? ""}`}>{norwood.restored}</figcaption>
          </figure>
        )}
      </div>
    </div>
  );
}
