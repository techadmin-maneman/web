import "../refs-as-props.ts";
import { FileInput } from "@maneman/ui/Field";
import { ICON_STROKES } from "@maneman/brand/icons";
import { Button } from "@maneman/ui/Button";
import { useRef } from "preact/hooks";
import { tryOn } from "../../content/site.ts";
import { Title, type HeadingRef } from "./Title.tsx";
import styles from "./TryOn.module.css";

/** The guide a photo is framed to: a dashed oval with gilt corners, and its line beneath. */
function Oval() {
  return (
    <svg viewBox="0 0 320 400" class={styles.oval} aria-hidden="true">
      <path
        d="M160 92 C196 92 218 126 218 178 C218 232 194 268 160 274 C126 268 102 232 102 178 C102 126 124 92 160 92 Z"
        class={styles.ovalGuide}
        fill="none"
        stroke-width={ICON_STROKES.regular}
        stroke-dasharray="6 6"
      />
      <path
        d="M30 30 H66 M30 30 V66 M290 30 H254 M290 30 V66 M30 370 H66 M30 370 V334 M290 370 H254 M290 370 V334"
        class={styles.ovalCorners}
        fill="none"
        stroke-width={ICON_STROKES.heavy}
      />
      <text
        x="160"
        y="332"
        class={styles.ovalLabel}
        font-family="EB Garamond, serif"
        font-size="15"
        letter-spacing="1.8"
        text-anchor="middle"
        font-variant="small-caps"
      >
        {tryOn.upload.oval}
      </text>
    </svg>
  );
}

/** Step one: the guidelines, and a photograph from the files or the camera. */
export function Upload(props: { photo: string | null; heading: HeadingRef; onChoose: (file: File) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  function chosen(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // Cleared, so choosing the same file again is still a choice.
    input.value = "";
    if (file !== undefined) props.onChoose(file);
  }

  return (
    <div class={styles.split}>
      <div>
        <Title heading={props.heading} className={styles.titleLarge}>
          {tryOn.upload.title}
        </Title>
        <p class={styles.body}>{tryOn.upload.body}</p>
        <ol class={styles.guidelines}>
          {tryOn.upload.guidelines.map((guideline) => (
            <li key={guideline.n} class={styles.guideline}>
              <span class={styles.guidelineNumber}>{guideline.n}</span>
              <div>
                <div class={styles.guidelineTitle}>{guideline.title}</div>
                <div class={styles.guidelineBody}>{guideline.body}</div>
              </div>
            </li>
          ))}
        </ol>
        <div class={styles.actions}>
          <Button
            variant="light"
            size="action"
            onClick={() => {
              fileInput.current?.click();
            }}
          >
            {tryOn.upload.choose}
          </Button>
          <Button
            variant="outlineOnInk"
            size="action"
            onClick={() => {
              cameraInput.current?.click();
            }}
          >
            {tryOn.upload.camera}
          </Button>
        </div>
        <FileInput ref={fileInput} accept="image/jpeg,image/png" hidden onChange={chosen} />
        <FileInput ref={cameraInput} accept="image/*" capture="user" hidden onChange={chosen} />
      </div>
      <div class={styles.preview}>
        {props.photo === null ? (
          <>
            <Oval />
            <div class={styles.previewCaption}>{tryOn.upload.previewCaption}</div>
          </>
        ) : (
          <img class={styles.previewPhoto} src={props.photo} alt={tryOn.upload.previewAlt} />
        )}
      </div>
    </div>
  );
}
