import "../refs-as-props.ts";
import { FileInput } from "@maneman/ui/Field";
import { Button } from "@maneman/ui/Button";
import { useRef } from "preact/hooks";
import { tryOn } from "../../content/site.ts";
import { Title, type HeadingRef } from "./Title.tsx";
import styles from "./TryOn.module.css";

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
            <svg viewBox="0 0 320 400" class={styles.oval} aria-hidden="true">
              <use href="#oval" />
            </svg>
            <div class={styles.previewCaption}>{tryOn.upload.previewCaption}</div>
          </>
        ) : (
          <img class={styles.previewPhoto} src={props.photo} alt={tryOn.upload.previewAlt} />
        )}
      </div>
    </div>
  );
}
