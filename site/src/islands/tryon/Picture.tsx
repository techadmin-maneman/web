// The picture beside each step of the try-on (ADR 0265). On a laptop it is the left of the step's two columns, as the
// boards draw it: the look beside the photograph once it is ready, else the photograph, else where a photo goes. On a
// phone only the ready look shows, above the step's words.

import { CLIENT_ICONS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { tryOn, tryOnTeaser } from "../../content/site.ts";
import BeforeAfter from "../BeforeAfter.tsx";
import styles from "./picture.module.css";

/** The client's framing, which keeps the hair in the frame (styles/global.css). */
const FRAMED = "focus-client";

export function Picture(props: { photo: string | null; look: string | null }) {
  const { ready } = tryOn.sent;
  if (props.look !== null) {
    return (
      <div class={`${styles.picture ?? ""} ${styles.ready ?? ""}`}>
        {props.photo === null ? (
          <img class={`${styles.fill ?? ""} ${FRAMED}`} src={props.look} alt={ready.lookAlt} />
        ) : (
          <BeforeAfter
            className={styles.compare}
            start={tryOnTeaser.start_percent}
            beforeLabel={tryOnTeaser.before}
            afterLabel={tryOnTeaser.after}
            sliderLabel={tryOnTeaser.sliderLabel}
            sliderValue={tryOnTeaser.sliderValue}
            before={<img class={FRAMED} src={props.photo} alt={ready.photoAlt} />}
            after={<img class={FRAMED} src={props.look} alt={ready.lookAlt} />}
          />
        )}
      </div>
    );
  }
  if (props.photo !== null) {
    return (
      <div class={styles.picture}>
        <img class={`${styles.fill ?? ""} ${FRAMED}`} src={props.photo} alt={tryOn.upload.previewAlt} />
      </div>
    );
  }
  return (
    <div class={`${styles.picture ?? ""} ${styles.empty ?? ""}`} aria-hidden="true">
      <Icon d={CLIENT_ICONS.camera} size="xl" />
    </div>
  );
}
