// Board B1: the guided capture of five angles, one tap each. It is step 1 of
// the job for the before set and step 5 for the after set; the screen is the
// same one.
//
// The frame comes from the camera into a canvas (./capture.ts), never from a
// file input, so nothing is written to the phone's gallery. Each frame goes
// into the app's own store and stays there until the outbox has PUT it to the
// link the API hands out and the set itself has landed
// (apps/tech/src/store/outbox.ts).

import { useCallback, useEffect, useRef, useState } from "react";
import type { Angle, Phase } from "../api.ts";
import { capture as copy, job as jobCopy } from "../content.ts";
import { Failed, Loading } from "../states/States.tsx";
import { StepFrame } from "../steps/StepFrame.tsx";
import { useStep } from "../steps/useStep.ts";
import { dropFrame, frames as keptFrames, keepFrame } from "../store/outbox.ts";
import { cameraAvailable, captureFrame, closeCamera, openCamera } from "./capture.ts";
import styles from "./capture.module.css";

/** The five angles, in the order the design guides them (board B1). */
const ANGLES: readonly Angle[] = ["front", "top", "left", "right", "hair"];

export function CaptureScreen({ id, phase }: { id: string; phase: Phase }) {
  const step = phase === "before" ? "before_photos" : "after_photos";
  const { loaded, retry, finish, back } = useStep(id, step);
  const video = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [taken, setTaken] = useState<readonly { angle: Angle; frameId: string }[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let opened: MediaStream | null = null;
    let current = true;
    if (!cameraAvailable()) setFailed(true);
    else {
      void openCamera().then(
        (camera) => {
          opened = camera;
          if (current) setStream(camera);
          else closeCamera(camera);
        },
        () => {
          if (current) setFailed(true);
        },
      );
    }
    return () => {
      current = false;
      closeCamera(opened);
    };
  }, []);

  /**
   * The camera and the element arrive in either order — the job's card may still
   * be loading when the camera opens — so the stream is attached whichever is
   * last. Capture then waits for the first frame, not merely for the camera to
   * open: a canvas drawn from a video with no dimensions yet holds nothing.
   */
  const attach = useCallback(
    (element: HTMLVideoElement | null) => {
      video.current = element;
      if (element !== null && stream !== null) element.srcObject = stream;
    },
    [stream],
  );

  // Anything already on the phone for this job and phase counts: a capture interrupted resumes.
  useEffect(() => {
    void keptFrames().then((held) => {
      setTaken(
        held
          .filter((frame) => frame.job_id === id && frame.phase === phase)
          .map((frame) => ({ angle: frame.angle, frameId: frame.id })),
      );
    });
  }, [id, phase]);

  const angle: Angle | undefined = ANGLES[taken.length];

  const take = useCallback(async () => {
    if (video.current === null || angle === undefined) return;
    try {
      const frame = await captureFrame(video.current);
      const frameId = await keepFrame(id, angle, phase, frame.blob);
      setTaken((already) => [...already, { angle, frameId }]);
    } catch {
      setFailed(true);
    }
  }, [angle, id, phase]);

  const retake = useCallback(async () => {
    const last = taken.at(-1);
    if (last === undefined) return;
    await dropFrame(last.frameId);
    setTaken((already) => already.slice(0, -1));
  }, [taken]);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <Failed message={jobCopy.failed} retry={jobCopy.retry} onRetry={retry} />;

  const all = taken.length === ANGLES.length;

  return (
    // The board heads this screen with the angles taken, not the step's place in the six.
    <StepFrame
      title={phase === "before" ? copy.before : copy.after}
      at={taken.length}
      of={ANGLES.length}
      action={copy.finish}
      ready={all}
      onBack={back}
      onAction={() => void finish({ phase })}
    >
      <div className={styles.stage}>
        {failed ? (
          <p className={styles.unavailable} role="alert">
            {copy.unavailable}
          </p>
        ) : (
          <>
            {/* Muted and inline: a technician's phone never plays sound, and never goes full screen. */}
            <video
              className={styles.view}
              ref={attach}
              autoPlay
              muted
              playsInline
              onLoadedMetadata={() => {
                setReady(true);
              }}
            />
            <p className={styles.guide}>{angle === undefined ? copy.done : copy.guide(copy.angles[angle])}</p>
          </>
        )}
      </div>

      <ul className={styles.tiles}>
        {ANGLES.map((name, index) => (
          <li
            className={styles.tile}
            key={name}
            data-state={index < taken.length ? "done" : index === taken.length ? "now" : "todo"}
          >
            <span className={styles.tileLabel}>{copy.angles[name]}</span>
          </li>
        ))}
      </ul>

      <div className={styles.shutter}>
        <button className={styles.retake} type="button" disabled={taken.length === 0} onClick={() => void retake()}>
          {copy.retake}
        </button>
        <button
          className={styles.take}
          type="button"
          disabled={!ready || angle === undefined}
          onClick={() => void take()}
        >
          {copy.take}
        </button>
      </div>
    </StepFrame>
  );
}
