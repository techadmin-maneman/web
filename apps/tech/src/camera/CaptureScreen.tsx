// Board B1: the guided capture of the five before angles, one tap each.
//
// The frame comes from the camera into a canvas (./capture.ts), never from a
// file input, so nothing is written to the phone's gallery. Each frame goes
// into the app's own store and stays there until its upload is confirmed.
//
// P2-M4's photograph routes are not built yet, so nothing is sent from here:
// the set waits on the waiting screen, which is what the outbox is for.

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { capture as copy } from "../content.ts";
import { BACK } from "../icons.ts";
import { go } from "../route.ts";
import { dropFrame, frames as keptFrames, keepFrame } from "../store/outbox.ts";
import { cameraAvailable, captureFrame, closeCamera, openCamera } from "./capture.ts";
import styles from "./capture.module.css";

/** The five angles, in the order the design guides them (board B1). */
const ANGLES = ["front", "top", "left", "right", "hair"] as const;
type Angle = (typeof ANGLES)[number];

const PHASE = "before";

export function CaptureScreen({ id }: { id: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [taken, setTaken] = useState<readonly { angle: string; frameId: string }[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let current = true;
    if (!cameraAvailable()) setFailed(true);
    else {
      void openCamera().then(
        (opened) => {
          stream = opened;
          if (!current) {
            closeCamera(opened);
            return;
          }
          // Capture waits for the first frame, not merely for the camera to open: a
          // canvas drawn from a video with no dimensions yet holds nothing.
          if (video.current !== null) video.current.srcObject = opened;
        },
        () => {
          if (current) setFailed(true);
        },
      );
    }
    return () => {
      current = false;
      closeCamera(stream);
    };
  }, []);

  // Anything already on the phone for this job counts: a capture interrupted resumes where it stopped.
  useEffect(() => {
    void keptFrames().then((held) => {
      setTaken(
        held
          .filter((frame) => frame.job_id === id && frame.phase === PHASE)
          .map((frame) => ({ angle: frame.angle, frameId: frame.id })),
      );
    });
  }, [id]);

  const angle: Angle | undefined = ANGLES[taken.length];

  const take = useCallback(async () => {
    if (video.current === null || angle === undefined) return;
    try {
      const frame = await captureFrame(video.current);
      const frameId = await keepFrame(id, angle, PHASE, frame.blob);
      setTaken((already) => [...already, { angle, frameId }]);
    } catch {
      setFailed(true);
    }
  }, [angle, id]);

  const retake = useCallback(async () => {
    const last = taken.at(-1);
    if (last === undefined) return;
    await dropFrame(last.frameId);
    setTaken((already) => already.slice(0, -1));
  }, [taken]);

  return (
    <main className={styles.screen}>
      <header className={styles.head}>
        <button
          className={styles.back}
          type="button"
          aria-label={copy.back}
          onClick={() => {
            go(`/jobs/${id}`);
          }}
        >
          <Icon d={BACK} size={24} />
        </button>
        <span className={styles.title}>{copy.before}</span>
        <span className={styles.progress}>{copy.progress(taken.length, ANGLES.length)}</span>
      </header>

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
              ref={video}
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

      <div className={styles.foot}>
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
    </main>
  );
}
