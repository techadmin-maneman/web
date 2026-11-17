// A phone's Norwood scale (ADR 0263): the five stages we fit as a choice above two pictures, the stage chosen and the
// restored hairline beside it. Choosing a stage changes only its own picture. The page draws the choice and every
// stage; where scripts run, the stages not chosen are hidden from the first paint, so the page does not shrink when
// this runs; where they never run, every stage shows, two to a row, and the choice is not drawn.

import "../refs-as-props.ts";
import { Segmented } from "@maneman/ui/Segmented";
import { useEffect, useState } from "preact/hooks";
import { illustrationTag, norwood, results } from "../../content/site.ts";
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

function StageTile({
  stage,
  placeholder,
  chosen,
  running,
}: {
  stage: PickerStage;
  placeholder: string | null;
  chosen: boolean;
  running: boolean;
}) {
  return (
    <figure class={styles.tile} data-chosen={String(chosen)} hidden={running && !chosen}>
      <div class={styles.frame}>
        <Picture picture={stage.picture} />
        <span class={`label ${styles.numeral ?? ""}`}>{stage.numeral}</span>
        {placeholder !== null && <span class={styles.band}>{placeholder}</span>}
      </div>
      <figcaption class={styles.caption}>
        <span class={styles.name}>{stage.name}</span>
        <span class={styles.sub}>{stage.tag}</span>
      </figcaption>
    </figure>
  );
}

export default function NorwoodPicker(props: {
  stages: readonly PickerStage[];
  restored: PickerPicture | null;
  /** Whether the restored hairline was made with an AI tool rather than photographed, so says so. */
  illustration: boolean;
  /** The Placeholder tag, where the stages' photographs are still marked as placeholders; null where they are not. */
  placeholder: string | null;
}) {
  const [at, setAt] = useState("0");
  const [running, setRunning] = useState(false);
  useEffect(() => {
    setRunning(true);
  }, []);
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
      <div class={styles.choices}>
        <Segmented
          pressed
          label={norwood.picker}
          options={props.stages.map((each, index) => [String(index), each.numeral] as const)}
          names={names}
          value={at}
          onChange={setAt}
        />
      </div>
      <div class={styles.tiles}>
        {props.stages.map((each) => (
          <StageTile
            stage={each}
            placeholder={props.placeholder}
            chosen={each === stage}
            running={running}
            key={each.numeral}
          />
        ))}
        {props.restored !== null && (
          <figure class={styles.tile}>
            <div class={`${styles.frame ?? ""} ${styles.restored ?? ""}`}>
              <Picture picture={props.restored} />
              <span class={`label ${styles.numeral ?? ""}`}>{results.after}</span>
              {props.illustration && <span class={styles.band}>{illustrationTag}</span>}
            </div>
            <figcaption class={`${styles.caption ?? ""} ${styles.name ?? ""}`}>{norwood.restored}</figcaption>
          </figure>
        )}
      </div>
    </div>
  );
}
