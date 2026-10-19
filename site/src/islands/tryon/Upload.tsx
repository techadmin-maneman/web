import "../refs-as-props.ts";
import { FileInput } from "@maneman/ui/Field";
import { ICON_STROKES } from "@maneman/brand/icons";
import { Button } from "@maneman/ui/Button";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { PhotoCapture } from "@maneman/ui/PhotoCapture";
import { lightOf } from "@maneman/web-kit/small-jpeg";
import { useEffect, useRef, useState } from "preact/hooks";
import { tryOn } from "../../content/site.ts";
import { useReleased } from "./hooks.ts";
import { Title, type HeadingRef } from "./Title.tsx";
import shared from "./TryOn.module.css";
import styles from "./upload.module.css";

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

/** False once the device is known to have no camera, so Take a photo is not offered. */
function useHasCamera(): boolean {
  const [has, setHas] = useState(true);
  useEffect(() => {
    const devices = navigator.mediaDevices as MediaDevices | undefined;
    if (devices?.enumerateDevices === undefined) return;
    devices
      .enumerateDevices()
      .then((found) => {
        setHas(found.some((device) => device.kind === "videoinput"));
      })
      .catch(() => undefined);
  }, []);
  return has;
}

/** Below this average light, out of 255, a photo is too dark to make a good look from. */
const DARKEST = 64;
/** Below this spread of light the picture is all one shade: the lens covered, or a camera that gave black. */
const LEAST_SPREAD = 6;

/** What to say over a photo before it is used: blank, too dark, or nothing. */
async function noteFor(photo: Blob): Promise<string | null> {
  try {
    const picture = await createImageBitmap(photo);
    const light = lightOf(picture, picture.width, picture.height);
    picture.close();
    if (light.spread < LEAST_SPREAD) return tryOn.upload.capture.blank;
    return light.mean < DARKEST ? tryOn.upload.capture.dark : null;
  } catch {
    return null;
  }
}

/** Where the photo being looked at came from: this page's camera, the phone's own, or the files. */
type From = "camera" | "phone" | "files";

interface Looking {
  readonly from: From;
  readonly file: File;
  readonly url: string;
  readonly note: string | null;
}

/** The file an input was given, the input cleared so that choosing the same file again is still a choice. */
function takeFile(event: Event): File | undefined {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  return file;
}

/** The camera open with nothing taken yet, a photo being looked at, or neither; and a photo to look at. */
function useTaking() {
  const [taking, setTaking] = useState<"camera" | Looking | null>(null);
  const looking = taking !== null && taking !== "camera" ? taking : null;
  useReleased(looking?.url ?? null);

  function look(from: From, file: File) {
    const url = URL.createObjectURL(file);
    setTaking({ from, file, url, note: null });
    void noteFor(file).then((note) => {
      setTaking((now) => (now !== null && now !== "camera" && now.url === url ? { ...now, note } : now));
    });
  }

  return { taking, looking, setTaking, look };
}

/** The step's words: what makes a good photo, in three. */
function Guidelines(props: { heading: HeadingRef }) {
  return (
    <>
      <Title heading={props.heading} className={shared.titleLarge}>
        {tryOn.upload.title}
      </Title>
      <p class={shared.body}>{tryOn.upload.body}</p>
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
    </>
  );
}

/** The frame beside the words: the oval waiting for a photo, which a phone does not draw, or the photo chosen. */
function Preview(props: { photo: string | null }) {
  if (props.photo !== null) {
    return (
      <div class={styles.preview}>
        <img class={styles.previewPhoto} src={props.photo} alt={tryOn.upload.previewAlt} />
      </div>
    );
  }
  return (
    <div class={`${styles.preview} ${styles.waiting}`}>
      <Oval />
      <div class={styles.previewCaption}>{tryOn.upload.previewCaption}</div>
    </div>
  );
}

/**
 * Step one: the guidelines, then a photograph taken or chosen, looked at before it is used. The camera opens over the
 * page, the whole screen on a phone; where the browser will not open it, Take a photo asks for the phone's own camera
 * through a file input instead, which a phone answers with its camera app.
 */
export function Upload(props: { photo: string | null; heading: HeadingRef; onChoose: (file: File) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const phoneCamera = useRef<HTMLInputElement>(null);
  const hasCamera = useHasCamera();
  const [blocked, setBlocked] = useState(false);
  const { taking, looking, setTaking, look } = useTaking();

  function again() {
    if (looking?.from === "files") fileInput.current?.click();
    else if (looking?.from === "phone") phoneCamera.current?.click();
    else setTaking("camera");
  }

  const chosen = (from: From) => (event: Event) => {
    const file = takeFile(event);
    if (file !== undefined) look(from, file);
  };

  const capture = tryOn.upload.capture;
  return (
    <div class={shared.split}>
      <div>
        <Guidelines heading={props.heading} />
        <div class={styles.actions}>
          {hasCamera && (
            <Button
              variant="light"
              size="action"
              onClick={() => {
                if (blocked) phoneCamera.current?.click();
                else setTaking("camera");
              }}
            >
              {tryOn.upload.camera}
            </Button>
          )}
          <Button
            variant={hasCamera ? "outlineOnInk" : "light"}
            size="action"
            onClick={() => {
              fileInput.current?.click();
            }}
          >
            {tryOn.upload.choose}
          </Button>
        </div>
        {blocked && (
          <InlineMessage tone="note" ground="ink" className={styles.blocked}>
            {tryOn.upload.blocked}
          </InlineMessage>
        )}
        <FileInput ref={fileInput} accept="image/jpeg,image/png" hidden onChange={chosen("files")} />
        <FileInput ref={phoneCamera} accept="image/*" capture="user" hidden onChange={chosen("phone")} />
      </div>
      <Preview photo={props.photo} />
      {taking !== null && (
        <PhotoCapture
          still={looking?.url ?? null}
          note={looking?.note ?? null}
          words={{ ...capture, again: looking?.from === "files" ? capture.another : capture.retake }}
          onTaken={(photo) => {
            look("camera", new File([photo], "camera.jpg", { type: "image/jpeg" }));
          }}
          onRefused={() => {
            setTaking(null);
            setBlocked(true);
          }}
          onUse={() => {
            if (looking === null) return;
            setTaking(null);
            props.onChoose(looking.file);
          }}
          onAgain={again}
          onClose={() => {
            setTaking(null);
          }}
        />
      )}
    </div>
  );
}
