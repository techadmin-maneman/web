// A label read in: typed, typed by a USB scanner (which ends with Enter), or read by the camera
// (docs/decisions/0162-scanning-labels.md). The back camera opens only while the person reads with it, and each frame
// is read for a QR code, in a worker (./qr-decoder.ts), until one is found.

import { useActionIcon } from "./icon-actions.ts";
import { ACTION_ICONS } from "@maneman/brand/action-icons";
import { useEffect, useRef, useState } from "react";
import { useCamera } from "./useCamera.ts";
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

/** The back camera, as a label is held up to it. */
const openBackCamera = () =>
  navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });

/**
 * The back camera, reading each frame for a QR code until one is found, which `onRead` is given once. `takes`: whether
 * to take a code read; one it does not take leaves the camera reading, as the label already in hand held up again.
 * `aim`: the words beneath a frame drawn over the picture, where a label is held, as the technician's hair system step
 * draws it.
 */
export function QrCamera({
  words,
  onRead,
  takes,
  aim,
}: {
  words: Pick<ScanWords, "opening" | "refused">;
  onRead: (text: string) => void;
  takes?: (text: string) => boolean;
  aim?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const read = useRef(onRead);
  const take = useRef(takes);
  const [camera] = useCamera(openBackCamera);
  // A reader that did not start, which the label is typed past as it is with no camera.
  const [broken, setBroken] = useState(false);
  const state = broken ? "refused" : camera.state;
  useEffect(() => {
    read.current = onRead;
    take.current = takes;
  }, [onRead, takes]);
  useEffect(() => {
    if (camera.state !== "open") return;
    let live = true;
    let timer = 0;
    const decoder = qrDecoder();
    const refuse = () => {
      if (live) setBroken(true);
    };
    const open = async () => {
      const element = video.current;
      if (!live || element === null) return;
      element.srcObject = camera.stream;
      await element.play();
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
          if (found !== null && found !== "" && (take.current?.(found) ?? true)) {
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
    };
  }, [camera]);
  return (
    <div className={styles.camera}>
      <div className={styles.view}>
        <video ref={video} className={styles.video} muted playsInline aria-hidden="true" />
        {aim !== undefined && (
          <>
            <span className={styles.frame} aria-hidden="true" />
            <span className={styles.aim}>{aim}</span>
          </>
        )}
      </div>
      {state === "opening" && <p className={styles.note}>{words.opening}</p>}
      {state === "refused" && (
        <p className={styles.note} role="alert">
          {words.refused}
        </p>
      )}
    </div>
  );
}

/** `onInk`: on the technician app's ground, as its kit reads labels. */
export function ScanField({
  words,
  onScan,
  className,
  onInk = false,
}: {
  words: ScanWords;
  onScan: (label: string) => void;
  className?: string;
  onInk?: boolean;
}) {
  const variant = onInk ? "outlineOnInk" : "outline";
  const [typed, setTyped] = useState("");
  const [reading, setReading] = useState(false);
  const addIcon = useActionIcon(ACTION_ICONS.plus);
  const scanIcon = useActionIcon(reading ? ACTION_ICONS.x : ACTION_ICONS.scanBarcode);
  const add = (text: string) => {
    const label = scanned(text);
    if (label === "") return;
    onScan(label);
    setTyped("");
  };
  return (
    <div className={className}>
      <Field onInk={onInk} label={words.label}>
        {(control) => (
          <TextInput
            {...control}
            onInk={onInk}
            autoCapitalize="characters"
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
          variant={variant}
          size="small"
          disabled={scanned(typed) === ""}
          icon={addIcon}
          onClick={() => {
            add(typed);
          }}
        >
          {words.add}
        </Button>
        <Button
          variant={variant}
          size="small"
          aria-pressed={reading}
          icon={scanIcon}
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
