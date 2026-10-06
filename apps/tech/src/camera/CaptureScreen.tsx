// The guided capture of five angles, one tap each. It is step 1 of
// the job for the before set and step 5 for the after set; the screen is the
// same one.
//
// The board's layout: the viewfinder with its framing guide — the head's
// dashed outline, the hairline, the corners — so every visit's photos
// are framed alike and the client's comparison lines up; the five angle tiles;
// and at the foot, where every screen keeps its action, Retake beside Capture.
// Once the five are in, the same key finishes the step. Nothing slides here:
// nothing moves while the camera is capturing.
//
// The frame comes from the camera into a canvas (./capture.ts), never from a
// file input, so nothing is written to the phone's gallery. Each frame goes
// into the app's own store with its thumbnail, one per angle, and stays there
// until the outbox has PUT both to the link the API hands out and the set itself
// has landed
// (apps/tech/src/store/outbox.ts). A double tap keeps one frame and moves on by
// one angle.
//
// The camera is let go while the app is hidden and opened again on the way
// back (./useCamera.ts). A frame that fails to keep — the phone full, say, which
// App says above every screen — is said here and can be taken again: it is not
// a camera that failed.
//
// A set the API refused opens here again with the photographs that reached us
// counted, and only the refused angles to take.

import { StepFrame, useSettled, useStep } from "../steps/index.ts";
import { Button } from "@maneman/ui/Button";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Angle, Phase } from "../api.ts";
import { capture as copy, job as jobCopy } from "../content.ts";
import { Failed, Loading } from "../states/States.tsx";
import { dropFrame, events as queuedEvents, frames as keptFrames, keepFrame } from "../store/outbox.ts";
import { ANGLES, anglesRefused, anglesTaken, type TakenAngle } from "../lib/sets.ts";
import { captureFrame } from "./capture.ts";
import { useCamera } from "./useCamera.ts";
import styles from "./capture.module.css";

/** Why a refused set is open again: the angles still to take again, or the set as a whole. Null once nothing is. */
function refusalNotice(refused: readonly Angle[], taken: readonly TakenAngle[]): string | null {
  if (refused.length === 0) return copy.refusedSet;
  const stillToTake = refused.filter((angle) => !taken.some((one) => one.angle === angle));
  if (stillToTake.length === 0) return null;
  return copy.refusedPhotos(stillToTake.map((angle) => copy.angles[angle].toLowerCase()));
}

/** The camera's framing guide, drawn over the camera in the board's own 320 by 420 box. */
function FramingGuide() {
  return (
    <svg className={styles.frame} viewBox="0 0 320 420" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path
        className={styles.head}
        d="M160 108 C202 108 226 148 226 204 C226 262 198 302 160 310 C122 302 94 262 94 204 C94 148 118 108 160 108 Z"
        strokeDasharray="8 8"
      />
      <path className={styles.hairline} d="M94 196 C118 168 202 168 226 196" />
      <path
        className={styles.corners}
        d="M36 44 H78 M36 44 V86 M284 44 H242 M284 44 V86 M36 376 H78 M36 376 V334 M284 376 H242 M284 376 V334"
      />
    </svg>
  );
}

export function CaptureScreen({ id, phase }: { id: string; phase: Phase }) {
  const step = phase === "before" ? "before_photos" : "after_photos";
  const { loaded, retry, refused, finish, back } = useStep(id, step);
  const video = useRef<HTMLVideoElement | null>(null);
  const [camera, reopen] = useCamera();
  const stream = camera.state === "open" ? camera.stream : null;
  const [taken, setTaken] = useState<readonly TakenAngle[]>([]);
  const [refusedAngles, setRefusedAngles] = useState<readonly Angle[]>([]);
  const [ready, setReady] = useState(false);
  const [missed, setMissed] = useState(false);
  const [, once] = useOneAtATime();
  const settled = useSettled();

  /**
   * The camera and the element arrive in either order — the job's card may still
   * be loading when the camera opens — so the stream is attached whichever is
   * last. Capture then waits for the first frame, not merely for the camera to
   * open: a canvas drawn from a video with no dimensions yet holds nothing, so
   * each new stream starts not ready.
   */
  const attach = useCallback(
    (element: HTMLVideoElement | null) => {
      video.current = element;
      setReady(false);
      if (element !== null && stream !== null) element.srcObject = stream;
    },
    [stream],
  );

  // What is already taken counts: a capture interrupted resumes, and a refused set keeps what reached us.
  useEffect(() => {
    let current = true;
    Promise.all([keptFrames(), queuedEvents()]).then(
      ([held, queued]) => {
        if (!current) return;
        setTaken(anglesTaken(held, queued, id, phase));
        setRefusedAngles(anglesRefused(held, id, phase));
      },
      () => {
        // A store that will not open holds nothing taken: the capture starts at the first angle.
      },
    );
    return () => {
      current = false;
    };
  }, [id, phase]);

  const angle: Angle | undefined = ANGLES.find((each) => !taken.some((one) => one.angle === each));

  const take = () =>
    once(async () => {
      if (video.current === null || angle === undefined) return;
      try {
        const frame = await captureFrame(video.current);
        const frameId = await keepFrame({ jobId: id, angle, phase, frame: frame.photo.blob, small: frame.small.blob });
        setMissed(false);
        setTaken((already) => [...already.filter((one) => one.angle !== angle), { angle, frameId }]);
      } catch {
        setMissed(true);
      }
    });

  // Only a frame on the phone can be taken again: a photograph that reached us stays.
  const lastOnPhone = taken.at(-1)?.frameId ?? null;
  const retake = () =>
    once(async () => {
      if (lastOnPhone === null) return;
      await dropFrame(lastOnPhone);
      setTaken((already) => already.slice(0, -1));
    });

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") {
    return <Failed message={jobCopy.failed} retry={jobCopy.retry} onRetry={retry} requestId={loaded.requestId} />;
  }

  const all = angle === undefined;
  // A tap while a frame is being kept is ignored (`once`), not drawn dim: the key never flickers between angles.
  const canCapture = stream !== null && ready;

  const shutter = (
    <div className={styles.shutter}>
      <Button
        variant="outlineOnInk"
        size="action"
        className={styles.retake}
        disabled={lastOnPhone === null}
        onClick={() => void retake()}
      >
        {copy.retake}
      </Button>
      <Button
        variant="gold"
        size="action"
        className={styles.take}
        disabled={!all && !canCapture}
        aria-disabled={!settled}
        onClick={() => {
          if (!settled) return;
          if (all) void finish({ phase });
          else void take();
        }}
      >
        {all ? copy.finish : copy.take}
      </Button>
    </div>
  );

  return (
    // The board heads this screen with the angles taken, not the step's place in the six.
    <StepFrame
      title={phase === "before" ? copy.before : copy.after}
      at={taken.length}
      of={ANGLES.length}
      action={copy.finish}
      ready={all}
      notice={refused === null ? null : refusalNotice(refusedAngles, taken)}
      still
      foot={shutter}
      onBack={back}
      onAction={() => void finish({ phase })}
    >
      <div className={styles.stage}>
        {camera.state === "refused" ? (
          <div className={styles.unavailable} role="alert">
            <p className={styles.unavailableLine}>{copy.unavailable}</p>
            <Button variant="outlineOnInk" size="small" onClick={reopen}>
              {copy.retry}
            </Button>
          </div>
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
            <FramingGuide />
            {missed ? (
              <p className={styles.guide} role="alert">
                {copy.missed}
              </p>
            ) : (
              <p className={styles.guide}>{angle === undefined ? copy.done : copy.guides[angle]}</p>
            )}
          </>
        )}
      </div>

      <ul className={styles.tiles}>
        {ANGLES.map((name) => (
          <li className={styles.tile} key={name} data-state={tileState(name, taken, angle)}>
            <span className={styles.tileLabel}>{copy.angles[name]}</span>
          </li>
        ))}
      </ul>
    </StepFrame>
  );
}

/** A tile is taken, the one to take now, or still to take. */
function tileState(name: Angle, taken: readonly TakenAngle[], now: Angle | undefined): "done" | "now" | "todo" {
  if (taken.some((one) => one.angle === name)) return "done";
  return name === now ? "now" : "todo";
}
