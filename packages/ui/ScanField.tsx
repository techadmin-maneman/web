// A label read in: typed, typed by a USB scanner (which ends with Enter), or read by the camera
// (docs/decisions/0162-scanning-labels.md). The back camera opens only while the person reads with it, and each frame
// is read for a QR code, in a worker (./qr-decoder.ts), until one is found.

import { useEffect, useRef, useState } from "react";
import { Button } from "./Button.tsx";
import { Field, TextInput } from "./Field.tsx";
import { qrDecoder } from "./qr-decoder.ts";
import { scanned } from "./scanned.ts";
import styles from "./scan-field.module.css";

export interface ScanWords {
  readonly label: string;
  readonly add: string;
  readonly camera: string;
  readonly stop: string;
  readonly opening: string;
  readonly refused: string;
}

/** The widest a frame is read at: enough for a label held close, and quick on any phone. */
const READ_WIDTH = 640;

/** How long between frames read. */
const EVERY_MS = 150;

/** The back camera, reading each frame for a QR code until one is found, which `onRead` is given once. */
export function QrCamera({
  words,
  onRead,
}: {
  words: Pick<ScanWords, "opening" | "refused">;
  onRead: (text: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const read = useRef(onRead);
  const [state, setState] = useState<"opening" | "open" | "refused">("opening");
  useEffect(() => {
    read.current = onRead;
  }, [onRead]);
  useEffect(() => {
    let live = true;
    let stream: MediaStream | null = null;
    let timer = 0;
    const decoder = qrDecoder();
    // No camera, or a reader that did not start: either way the label is typed.
    const refuse = () => {
      if (live) setState("refused");
    };
    const open = async () => {
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      stream = media;
      const element = video.current;
      if (!live || element === null) return;
      element.srcObject = media;
      await element.play();
      setState("open");
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      const frame = async () => {
        if (!live || context === null) return;
        if (element.videoWidth > 0) {
          const scale = Math.min(1, READ_WIDTH / element.videoWidth);
          canvas.width = Math.round(element.videoWidth * scale);
          canvas.height = Math.round(element.videoHeight * scale);
          context.drawImage(element, 0, 0, canvas.width, canvas.height);
          // A decoder closed with the camera answers no more, so nothing is read after it closes.
          const found = await decoder.read(context.getImageData(0, 0, canvas.width, canvas.height));
          if (found !== null && found !== "") {
            read.current(found);
            return;
          }
        }
        timer = window.setTimeout(() => void frame().catch(refuse), EVERY_MS);
      };
      await frame();
    };
    open().catch(refuse);
    return () => {
      live = false;
      window.clearTimeout(timer);
      decoder.close();
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
  }, []);
  return (
    <div className={styles.camera}>
      <video ref={video} className={styles.video} muted playsInline aria-hidden="true" />
      {state === "opening" && <p className={styles.note}>{words.opening}</p>}
      {state === "refused" && (
        <p className={styles.note} role="alert">
          {words.refused}
        </p>
      )}
    </div>
  );
}

export function ScanField({
  words,
  onScan,
  className,
}: {
  words: ScanWords;
  onScan: (label: string) => void;
  className?: string;
}) {
  const [typed, setTyped] = useState("");
  const [reading, setReading] = useState(false);
  const add = (text: string) => {
    const label = scanned(text);
    if (label === "") return;
    onScan(label);
    setTyped("");
  };
  return (
    <div className={className}>
      <Field label={words.label}>
        {(control) => (
          <TextInput
            {...control}
            autoComplete="off"
            spellCheck={false}
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              add(typed);
            }}
          />
        )}
      </Field>
      <div className={styles.actions}>
        <Button
          variant="outline"
          size="small"
          disabled={scanned(typed) === ""}
          onClick={() => {
            add(typed);
          }}
        >
          {words.add}
        </Button>
        <Button
          variant="outline"
          size="small"
          aria-pressed={reading}
          onClick={() => {
            setReading(!reading);
          }}
        >
          {reading ? words.stop : words.camera}
        </Button>
      </div>
      {reading && (
        <QrCamera
          words={words}
          onRead={(text) => {
            setReading(false);
            add(text);
          }}
        />
      )}
    </div>
  );
}
