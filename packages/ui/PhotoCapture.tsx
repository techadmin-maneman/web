// A photograph taken or chosen, then looked at before it is used: a native modal <dialog>, the whole screen on a
// phone and a frame over the page on a wider one. First the camera's view, the oval a face is framed to, the view
// around it dimmed, and the shutter beneath; then the photograph itself, with its way to take or choose another, and to use it. A phone's Back and
// Escape close it, as they close a sheet (./sheetHistory.ts).
//
// The photograph is what the view showed: the part of the camera's frame the screen drew, mirrored as the view was
// where the camera faces the person. The camera is ./useCamera.ts, open only while its view is drawn.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ICONS } from "@maneman/brand/icons";
import { Button } from "./Button.tsx";
import { classes } from "./classes.ts";
import { IconButton } from "./IconButton.tsx";
import { enterSheet } from "./sheetHistory.ts";
import { useCamera } from "./useCamera.ts";
import { useModal } from "./useModal.ts";
import styles from "./photo-capture.module.css";

export interface PhotoCaptureWords {
  /** The dialog's name, read as it opens. */
  readonly title: string;
  /** The camera's view, for a screen reader. */
  readonly view: string;
  /** Above the camera's view: what to frame. */
  readonly hint: string;
  readonly shutter: string;
  readonly close: string;
  /** The photograph, for a screen reader. */
  readonly still: string;
  /** Above the photograph: what to look for in it. */
  readonly check: string;
  readonly use: string;
  /** Take another, or choose another. */
  readonly again: string;
}

/** The long side asked of the camera: room to keep the part the screen drew, before the photograph is made smaller. */
const CAMERA_LONG_SIDE = 1920;

function openFront(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: CAMERA_LONG_SIDE }, height: { ideal: CAMERA_LONG_SIDE } },
    audio: false,
  });
}

/** The part of the camera's frame the view draws, as `object-fit: cover` crops it, mirrored if the view is. */
function shownFrame(video: HTMLVideoElement, mirrored: boolean): HTMLCanvasElement {
  const scale = Math.max(video.clientWidth / video.videoWidth, video.clientHeight / video.videoHeight);
  const width = Math.round(video.clientWidth / scale);
  const height = Math.round(video.clientHeight / scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("this browser has no 2d canvas");
  if (mirrored) {
    context.translate(width, 0);
    context.scale(-1, 1);
  }
  const left = Math.round((video.videoWidth - width) / 2);
  const top = Math.round((video.videoHeight - height) / 2);
  context.drawImage(video, left, top, width, height, 0, 0, width, height);
  return canvas;
}

function photoOf(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) reject(new Error("the photograph could not be encoded"));
        else resolve(blob);
      },
      "image/jpeg",
      0.92,
    );
  });
}

/** The camera's view and its shutter, which waits for the camera's first frame. */
function Camera(props: {
  readonly words: PhotoCaptureWords;
  readonly onTaken: (photo: Blob) => void;
  readonly onRefused: () => void;
  readonly onClose: () => void;
}) {
  const [camera] = useCamera(openFront);
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const refused = useRef(props.onRefused);
  useLayoutEffect(() => {
    refused.current = props.onRefused;
  });

  useEffect(() => {
    if (camera.state === "refused") refused.current();
    if (video.current !== null) video.current.srcObject = camera.state === "open" ? camera.stream : null;
    if (camera.state !== "open") setReady(false);
  }, [camera]);

  async function take() {
    const shown = video.current;
    if (shown === null || !ready) return;
    props.onTaken(await photoOf(shownFrame(shown, true)));
  }

  return (
    <>
      <div className={styles.view}>
        <video
          ref={video}
          className={styles.live}
          autoPlay
          muted
          playsInline
          aria-label={props.words.view}
          onLoadedData={() => {
            setReady(true);
          }}
        />
        <div className={styles.face} aria-hidden="true" />
        <p className={styles.hint}>{props.words.hint}</p>
      </div>
      <div className={styles.bar}>
        <IconButton
          d={ICONS.cross}
          size="md"
          label={props.words.close}
          className={styles.close}
          onClick={props.onClose}
        />
        <button
          type="button"
          className={styles.shutter}
          aria-label={props.words.shutter}
          disabled={!ready}
          onClick={() => {
            void take();
          }}
        />
        <span className={styles.balance} />
      </div>
    </>
  );
}

/** The photograph, to use or to take or choose again. */
function Still(props: {
  readonly src: string;
  readonly note: string | null;
  readonly agreement: ReactNode;
  readonly words: PhotoCaptureWords;
  readonly onUse: () => void;
  readonly onAgain: () => void;
  readonly onClose: () => void;
}) {
  return (
    <>
      <div className={styles.view}>
        <img className={styles.still} src={props.src} alt={props.words.still} />
        <IconButton
          d={ICONS.cross}
          size="md"
          label={props.words.close}
          className={styles.closeOver}
          onClick={props.onClose}
        />
        <p className={styles.hint} role={props.note === null ? undefined : "status"}>
          {props.note ?? props.words.check}
        </p>
      </div>
      <div className={classes(styles.bar, styles.answers)}>
        {props.agreement !== null && <p className={styles.agreement}>{props.agreement}</p>}
        <Button variant="outlineOnInk" size="action" onClick={props.onAgain}>
          {props.words.again}
        </Button>
        <Button variant="light" size="action" onClick={props.onUse}>
          {props.words.use}
        </Button>
      </div>
    </>
  );
}

/**
 * The camera, while `still` is null; then the photograph at `still`, with `note` said over it in place of the
 * check, where the caller found something to say: a photograph too dark to use well. `onRefused` is the camera
 * refused or missing, for the caller to offer another way.
 */
export function PhotoCapture(props: {
  readonly still: string | null;
  readonly note?: string | null;
  /** Beneath the photograph, above its answers: what using it agrees to, where using it is an agreement. */
  readonly agreement?: ReactNode;
  readonly words: PhotoCaptureWords;
  readonly className?: string;
  readonly onTaken: (photo: Blob) => void;
  readonly onRefused: () => void;
  readonly onUse: () => void;
  readonly onAgain: () => void;
  readonly onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const leaving = useModal(dialog);
  const closing = useRef(props.onClose);
  useLayoutEffect(() => {
    closing.current = props.onClose;
  });
  useLayoutEffect(
    () =>
      enterSheet(() => {
        closing.current();
      }),
    [],
  );
  useLayoutEffect(() => {
    dialog.current?.focus();
  }, []);
  const close = useCallback(() => {
    closing.current();
  }, []);

  return (
    <dialog
      ref={dialog}
      className={classes(styles.frame, props.className)}
      aria-label={props.words.title}
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClose={(event) => {
        const closed = event.currentTarget;
        if (!leaving.current && closed.isConnected && !closed.open) closed.showModal();
      }}
    >
      {props.still === null ? (
        <Camera words={props.words} onTaken={props.onTaken} onRefused={props.onRefused} onClose={close} />
      ) : (
        <Still
          src={props.still}
          note={props.note ?? null}
          agreement={props.agreement ?? null}
          words={props.words}
          onUse={props.onUse}
          onAgain={props.onAgain}
          onClose={close}
        />
      )}
    </dialog>
  );
}
