// The guided capture of five angles, for the before set (step 1) and the after set (step 5), as the technician board
// draws it. Frames go from the camera to a canvas and into IndexedDB, never the gallery, and wait there until the
// outbox has uploaded them (./capture.ts, ../store/outbox.ts; docs/decisions/0053-the-technician-app-offline.md).

import { Tile } from "@maneman/ui/Tile";
import { StepFrame, useSettled, useStep } from "../steps/index.ts";
import { Button } from "@maneman/ui/Button";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Angle, Phase } from "../api.ts";
import { capture as copy } from "../content.ts";
import { JobFailed } from "../states/JobFailed.tsx";
import { Loading } from "../states/States.tsx";
import { dropFrame, events as queuedEvents, frames as keptFrames, keepFrame } from "../store/outbox.ts";
import { ANGLES, anglesRefused, anglesTaken, type TakenAngle } from "../lib/sets.ts";
import { BlankFrame, captureFrame, openCamera } from "./capture.ts";
import { useCamera } from "@maneman/ui/useCamera";
import { Torch } from "./Torch.tsx";
import { useThumbnails } from "./useThumbnails.ts";
import styles from "./capture.module.css";

/** Why a refused set is open again: the angles still to take again, or the set as a whole. Null once nothing is. */
function refusalNotice(refused: readonly Angle[], taken: readonly TakenAngle[]): string | null {
  if (refused.length === 0) return copy.refusedSet;
  const stillToTake = refused.filter((angle) => !taken.some((one) => one.angle === angle));
  if (stillToTake.length === 0) return null;
  return copy.refusedPhotos(stillToTake.map((angle) => copy.angles[angle].toLowerCase()));
}

/** The head from the front, as the board draws it. */
const FACE =
  "M160 108 C202 108 226 148 226 204 C226 262 198 302 160 310 C122 302 94 262 94 204 C94 148 118 108 160 108 Z";
/** The head from the side, facing left: the brow and nose on the left, the back of the head round on the right. */
const PROFILE =
  "M170 104 C222 104 246 150 240 210 C236 262 214 300 172 310 C146 312 128 300 122 282 L116 252 L100 236 L114 222 " +
  "L108 176 C112 132 136 104 170 104 Z";

/** What each angle lines up: the face and its hairline, the crown from above, an ear at the centre, the hair close. */
const OUTLINES: Record<Angle, { readonly head: string; readonly line: string }> = {
  front: { head: FACE, line: "M94 196 C118 168 202 168 226 196" },
  top: { head: "M160 112 A100 100 0 1 1 159.9 112 Z", line: "M96 170 C124 138 196 138 224 170" },
  left: { head: PROFILE, line: "M178 196 C192 196 192 230 178 230" },
  right: { head: PROFILE, line: "M178 196 C192 196 192 230 178 230" },
  hair: { head: "M100 150 H220 V270 H100 Z", line: "M100 210 H220" },
};

/** The camera's framing guide for the angle to take, drawn over the camera in the board's own 320 by 420 box. */
function FramingGuide({ angle }: { angle: Angle }) {
  const outline = OUTLINES[angle];
  return (
    <svg className={styles.frame} viewBox="0 0 320 420" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {/* The right side is the left's profile turned to face the other way. */}
      <g transform={angle === "right" ? "matrix(-1 0 0 1 320 0)" : undefined}>
        <path className={styles.head} d={outline.head} strokeDasharray="8 8" />
        <path className={styles.hairline} d={outline.line} />
      </g>
      <path
        className={styles.corners}
        d="M36 44 H78 M36 44 V86 M284 44 H242 M284 44 V86 M36 376 H78 M36 376 V334 M284 376 H242 M284 376 V334"
      />
    </svg>
  );
}

/** What lies over the camera: the guide for the angle to take, and the torch where the camera has one. */
function Overlay({ angle, stream }: { angle: Angle; stream: MediaStream | null }) {
  return (
    <>
      <FramingGuide angle={angle} />
      <Torch stream={stream} />
    </>
  );
}

/** A camera that would not open: asked for again, or the step goes on without its photographs, for ops to look at. */
function NoCamera(props: { onRetry: () => void; onWithout: () => void }) {
  return (
    <div className={styles.unavailable} role="alert">
      <p className={styles.unavailableLine}>{copy.unavailable}</p>
      <Button variant="outlineOnInk" size="small" onClick={props.onRetry}>
        {copy.retry}
      </Button>
      <Button variant="outlineOnInk" size="small" onClick={props.onWithout}>
        {copy.withoutPhotos}
      </Button>
    </div>
  );
}

/** Retake the last on the phone, and the shutter, which finishes the set once every angle is taken. */
function Shutter(props: {
  all: boolean;
  canRetake: boolean;
  canCapture: boolean;
  settled: boolean;
  onRetake: () => void;
  onTake: () => void;
}) {
  return (
    <div className={styles.shutter}>
      <Button
        variant="outlineOnInk"
        size="action"
        className={styles.retake}
        disabled={!props.canRetake}
        onClick={props.onRetake}
      >
        {copy.retake}
      </Button>
      <Button
        variant="gold"
        size="action"
        className={styles.take}
        disabled={!props.all && !props.canCapture}
        settling={!props.settled}
        onClick={props.onTake}
      >
        {props.all ? copy.finish : copy.take}
      </Button>
    </div>
  );
}

/** The five angles beneath the camera: each taken one's picture, a tap on it to take it again while that can be. */
function Tiles(props: {
  taken: readonly TakenAngle[];
  now: Angle | undefined;
  pictures: ReadonlyMap<string, string>;
  onRetake: (frameId: string) => void;
}) {
  const { taken } = props;
  return (
    <ul className={styles.tiles}>
      {ANGLES.map((name) => {
        const one = taken.find((each) => each.angle === name);
        const frameId = one?.frameId ?? null;
        const picture = frameId === null ? undefined : props.pictures.get(frameId);
        const label = <span className={styles.tileLabel}>{copy.angles[name]}</span>;
        return (
          <li className={styles.tile} key={name} data-state={tileState(name, taken, props.now)}>
            {picture !== undefined && <img className={styles.tilePicture} src={picture} alt="" />}
            {frameId === null || one?.sending === true ? (
              label
            ) : (
              <Tile
                className={styles.tileRetake}
                aria-label={copy.retakeAngle(copy.angles[name])}
                onClick={() => {
                  props.onRetake(frameId);
                }}
              >
                {label}
              </Tile>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function CaptureScreen({ id, phase }: { id: string; phase: Phase }) {
  const step = phase === "before" ? "before_photos" : "after_photos";
  const { loaded, retry, refused, finish, back } = useStep(id, step);
  const video = useRef<HTMLVideoElement | null>(null);
  const [camera, reopen] = useCamera(openCamera);
  const stream = camera.state === "open" ? camera.stream : null;
  const [taken, setTaken] = useState<readonly TakenAngle[]>([]);
  const [refusedAngles, setRefusedAngles] = useState<readonly Angle[]>([]);
  const [ready, setReady] = useState(false);
  // Why the last tap kept no frame: it did not save, or it came out blank.
  const [missed, setMissed] = useState<"missed" | "blank" | null>(null);
  const [, once] = useOneAtATime();
  const settled = useSettled();
  const pictures = useThumbnails(taken);

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
        setMissed(null);
        setTaken((already) => [...already.filter((one) => one.angle !== angle), { angle, frameId, sending: false }]);
      } catch (error) {
        setMissed(error instanceof BlankFrame ? "blank" : "missed");
      }
    });

  // Only a frame on the phone can be taken again: a photograph that reached us stays. The angle let go is the first
  // not taken, so it is the one taken next.
  const last = taken.at(-1);
  const lastOnPhone = last === undefined || last.sending ? null : last.frameId;
  const retake = (frameId: string | null) =>
    once(async () => {
      if (frameId === null) return;
      await dropFrame(frameId);
      setTaken((already) => already.filter((one) => one.frameId !== frameId));
    });

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") {
    return <JobFailed failed={loaded} onRetry={retry} />;
  }

  const all = angle === undefined;
  // A tap while a frame is being kept is ignored (`once`), not drawn dim: the key never flickers between angles.
  const canCapture = stream !== null && ready;

  const shutter = (
    <Shutter
      all={all}
      canRetake={lastOnPhone !== null}
      canCapture={canCapture}
      settled={settled}
      onRetake={() => void retake(lastOnPhone)}
      onTake={() => {
        if (all) void finish({ phase });
        else void take();
      }}
    />
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
          <NoCamera onRetry={reopen} onWithout={() => void finish({ phase, unavailable: true })} />
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
            <Overlay angle={angle ?? "front"} stream={stream} />
            {missed !== null ? (
              <p className={styles.guide} role="alert">
                {copy[missed]}
              </p>
            ) : (
              <p className={styles.guide}>{angle === undefined ? copy.done : copy.guides[angle]}</p>
            )}
          </>
        )}
      </div>

      <Tiles taken={taken} now={angle} pictures={pictures} onRetake={(frameId) => void retake(frameId)} />
    </StepFrame>
  );
}

/** A tile is taken, the one to take now, or still to take. */
function tileState(name: Angle, taken: readonly TakenAngle[], now: Angle | undefined): "done" | "now" | "todo" {
  if (taken.some((one) => one.angle === name)) return "done";
  return name === now ? "now" : "todo";
}
