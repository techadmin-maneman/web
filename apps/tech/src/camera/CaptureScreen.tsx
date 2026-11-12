// The before and after photographs (docs/prompts/tech-redesign.md, "Photos"; docs/decisions/0244-the-visit-engine.md):
// a camera screen of its own, five angles with a head-shape guide and each angle's prompt, the angle to take outlined
// in brass, Retake, the torch, Compare, and "Saved on phone". Frames go from the camera to a canvas and into
// IndexedDB, never the gallery, and wait there until the outbox has uploaded them (./capture.ts, ../store/outbox.ts).

import { ICONS } from "@maneman/brand/icons";
import { Button } from "@maneman/ui/Button";
import { IconButton } from "@maneman/ui/IconButton";
import { Shutter } from "@maneman/ui/Shutter";
import { Tile } from "@maneman/ui/Tile";
import { ToggleButton } from "@maneman/ui/ToggleButton";
import { useCamera } from "@maneman/ui/useCamera";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Angle, Phase } from "../api.ts";
import { capture as copy, storage, visit as visitCopy } from "../content.ts";
import { NoSignal } from "../frame/Banners.tsx";
import { JobFailed } from "../frame/JobFailed.tsx";
import { Loading } from "../frame/States.tsx";
import { ANGLES, anglesRefused, anglesTaken, type TakenAngle } from "../lib/sets.ts";
import { buzz } from "../lib/haptics.ts";
import { useScreen } from "../lib/useScreen.ts";
import { go } from "../route.ts";
import { useOnline } from "../session.ts";
import { useStep } from "../steps/index.ts";
import { isStorageFull, onStorageFull } from "../store/db.ts";
import { dropFrame, events as queuedEvents, frames as keptFrames, keepFrame } from "../store/outbox.ts";
import { BlankFrame, captureFrame, openCamera } from "./capture.ts";
import { FramingGuide } from "./FramingGuide.tsx";
import { Torch } from "./Torch.tsx";
import { useThumbnails } from "./useThumbnails.ts";
import styles from "./capture.module.css";
import { theirs } from "../lang/index.ts";

/** Why a refused set is open again: the angles still to take again, or the set as a whole. Null once nothing is. */
function refusalNotice(refused: readonly Angle[], taken: readonly TakenAngle[]): string | null {
  if (refused.length === 0) return copy.refusedSet;
  const stillToTake = refused.filter((angle) => !taken.some((one) => one.angle === angle));
  if (stillToTake.length === 0) return null;
  return copy.refusedPhotos(stillToTake.map((angle) => copy.angles[angle].toLowerCase()));
}

/** Why a set ops sent back is open again, as they said it; null for a set not sent back. */
const sentBackNotice = (sentBack: string | null): string | null =>
  sentBack === null ? null : visitCopy.sentBack(theirs(sentBack));

/**
 * While the phone has no room for another photograph, a red bar says so. The shutter stays: the phone learns it has
 * room again only by keeping a photograph.
 */
function useFull(): boolean {
  const [full, setFull] = useState(isStorageFull);
  useEffect(() => onStorageFull(setFull), []);
  return full;
}

/** The frames already taken: a capture interrupted resumes, and a refused set keeps what reached us. */
function useTaken(id: string, phase: Phase) {
  const [taken, setTaken] = useState<readonly TakenAngle[]>([]);
  const [refusedAngles, setRefusedAngles] = useState<readonly Angle[]>([]);
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
  return { taken, setTaken, refusedAngles };
}

/** A camera that would not open: asked for again, or the set goes without its photographs, and ops are told. */
function NoCamera(props: { onRetry: () => void; onWithout: () => void }) {
  return (
    <div className={styles.unavailable} role="alert">
      <p className={styles.unavailableTitle}>{copy.unavailableTitle}</p>
      <p className={styles.unavailableLine}>{copy.unavailable}</p>
      <Button variant="primary" size="action" onClick={props.onRetry}>
        {copy.retry}
      </Button>
      <Button variant="outline" size="action" onClick={props.onWithout}>
        {copy.withoutPhotos}
      </Button>
      <p className={styles.unavailableLine}>{copy.opsTold}</p>
    </div>
  );
}

/** The five angles in a strip: each taken one's picture, the one to take in brass, a tap to take one again. */
function Tiles(props: {
  taken: readonly TakenAngle[];
  now: Angle | undefined;
  pictures: ReadonlyMap<string, string>;
  onRetake: (frameId: string) => void;
}) {
  return (
    <ul className={styles.tiles}>
      {ANGLES.map((name) => {
        const one = props.taken.find((each) => each.angle === name);
        const frameId = one?.frameId ?? null;
        const picture = frameId === null ? undefined : props.pictures.get(frameId);
        const label = <span className={styles.tileLabel}>{copy.angles[name]}</span>;
        return (
          <li className={styles.tile} key={name} data-state={tileState(name, props.taken, props.now)}>
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

/** A tile is taken, the one to take now, or still to take. */
function tileState(name: Angle, taken: readonly TakenAngle[], now: Angle | undefined): "done" | "now" | "todo" {
  if (taken.some((one) => one.angle === name)) return "done";
  return name === now ? "now" : "todo";
}

/**
 * The photograph the angle to take is compared with, from the API (../../../../src/routes/tech/jobs.routes.ts): shown
 * as a choice only once it has loaded, so with no signal, or none to compare with, Compare does not show.
 */
function Compare(props: {
  id: string;
  phase: Phase;
  angle: Angle | undefined;
  on: boolean;
  onLoad: (url: string | null) => void;
}) {
  if (props.angle === undefined) return null;
  const url = `/api/tech/jobs/${props.id}/compare/${props.phase}/${props.angle}`;
  return (
    <img
      key={url}
      className={props.on ? styles.compare : styles.compareHidden}
      src={url}
      alt={copy.compareImage[props.phase](copy.angles[props.angle])}
      onLoad={() => {
        props.onLoad(url);
      }}
      onError={() => {
        props.onLoad(null);
      }}
    />
  );
}

/** What the line over the view says: the angle's prompt, that the set is taken, or why the last tap kept nothing. */
function promptOf(missed: "missed" | "blank" | null, angle: Angle | undefined): string {
  if (missed !== null) return copy[missed];
  return angle === undefined ? copy.done : copy.guides[angle];
}

/**
 * The camera's head: the way back to the visit's plan, as from every step, the step's name with the angles taken, and
 * the torch; beneath it, with no signal, the bar that says the photographs are kept.
 */
function CameraHead(props: {
  id: string;
  title: string;
  taken: number;
  stream: MediaStream | null;
  heading: (element: HTMLHeadingElement | null) => void;
}) {
  const online = useOnline();
  return (
    <>
      <header className={styles.top}>
        <IconButton
          className={styles.back}
          d={ICONS.back}
          size="lg"
          label={copy.back}
          onClick={() => {
            go(`/jobs/${props.id}/plan`);
          }}
        />
        <div className={styles.titles}>
          <h1 className={styles.title} ref={props.heading} tabIndex={-1}>
            {props.title}
          </h1>
          <p className={styles.count}>{copy.of(props.taken)}</p>
        </div>
        <Torch stream={props.stream} />
      </header>
      {!online && <NoSignal />}
    </>
  );
}

/** Retake the last on the phone, the shutter or Done once every angle is taken, and that each is kept on the phone. */
function Controls(props: {
  all: boolean;
  canRetake: boolean;
  canTake: boolean;
  onRetake: () => void;
  onTake: () => void;
  onDone: () => void;
}) {
  return (
    <div className={styles.controls}>
      <Button
        variant="outline"
        size="action"
        className={styles.retake}
        disabled={!props.canRetake}
        onClick={props.onRetake}
      >
        {copy.retake}
      </Button>
      {props.all ? (
        <Button variant="primary" size="action" onClick={props.onDone}>
          {copy.finish}
        </Button>
      ) : (
        <Shutter label={copy.take} disabled={!props.canTake} onTake={props.onTake} />
      )}
      <span className={styles.saved}>{copy.saved}</span>
    </div>
  );
}

/**
 * The camera's stream on the video element. The camera and the element arrive in either order, so the stream is
 * attached whichever is last; capture then waits for the first frame, since a canvas drawn from a video with no
 * dimensions yet holds nothing.
 */
function useView(stream: MediaStream | null) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);
  const attach = useCallback(
    (element: HTMLVideoElement | null) => {
      video.current = element;
      setReady(false);
      if (element !== null && stream !== null) element.srcObject = stream;
    },
    [stream],
  );
  return { video, attach, ready, setReady };
}

export function CaptureScreen({ id, phase }: { id: string; phase: Phase }) {
  const title = phase === "before" ? copy.before : copy.after;
  const heading = useScreen(title);
  const { loaded, retry, refused, sentBack, finish } = useStep(id, `${phase}_photos`);
  const [camera, reopen] = useCamera(openCamera);
  const stream = camera.state === "open" ? camera.stream : null;
  const { video, attach, ready, setReady } = useView(stream);
  const { taken, setTaken, refusedAngles } = useTaken(id, phase);
  // Why the last tap kept no frame: it did not save, or it came out blank.
  const [missed, setMissed] = useState<"missed" | "blank" | null>(null);
  const [comparing, setComparing] = useState(false);
  const [comparable, setComparable] = useState<string | null>(null);
  const [, once] = useOneAtATime();
  const full = useFull();
  const pictures = useThumbnails(taken);

  const angle: Angle | undefined = ANGLES.find((each) => !taken.some((one) => one.angle === each));
  const compareUrl = angle === undefined ? null : `/api/tech/jobs/${id}/compare/${phase}/${angle}`;

  const take = () =>
    once(async () => {
      if (video.current === null || angle === undefined) return;
      try {
        const frame = await captureFrame(video.current);
        const frameId = await keepFrame({ jobId: id, angle, phase, frame: frame.photo.blob, small: frame.small.blob });
        buzz();
        setMissed(null);
        setTaken((already) => [...already.filter((one) => one.angle !== angle), { angle, frameId, sending: false }]);
      } catch (error) {
        setMissed(error instanceof BlankFrame ? "blank" : "missed");
      }
    });

  // Only a frame on the phone can be taken again: a photograph that reached us stays.
  const last = taken.at(-1);
  const lastOnPhone = last === undefined || last.sending ? null : last.frameId;
  const retake = (frameId: string | null) =>
    once(async () => {
      if (frameId === null) return;
      await dropFrame(frameId);
      setTaken((already) => already.filter((one) => one.frameId !== frameId));
    });

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <JobFailed failed={loaded} onRetry={retry} />;

  const all = angle === undefined;
  // A refused set says which angles to take again; one ops sent back, what they said (ADR 0246).
  const notice = refused === null ? sentBackNotice(sentBack) : refusalNotice(refusedAngles, taken);
  const canCompare = comparable !== null && comparable === compareUrl;
  return (
    <div className={styles.look} data-look="light">
      <main className={styles.screen} data-chrome="camera">
        <CameraHead id={id} title={title} taken={taken.length} stream={stream} heading={heading} />
        {canCompare && (
          <div className={styles.compareBar}>
            <ToggleButton
              className={styles.compareToggle}
              pressed={comparing}
              onClick={() => {
                setComparing(!comparing);
              }}
            >
              {copy.compareWith[phase]}
            </ToggleButton>
          </div>
        )}
        {full && (
          <p className={styles.alertBar} role="alert">
            {storage.title}
          </p>
        )}
        {notice !== null && (
          <p className={styles.alertBar} role="alert">
            {notice}
          </p>
        )}
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
              <FramingGuide angle={angle ?? "front"} />
              <Compare id={id} phase={phase} angle={angle} on={comparing && canCompare} onLoad={setComparable} />
              <p className={styles.prompt} role={missed === null ? undefined : "alert"}>
                {promptOf(missed, angle)}
              </p>
            </>
          )}
        </div>
        <div className={styles.dock}>
          <Tiles taken={taken} now={angle} pictures={pictures} onRetake={(frameId) => void retake(frameId)} />
          <Controls
            all={all}
            canRetake={lastOnPhone !== null}
            canTake={stream !== null && ready}
            onRetake={() => void retake(lastOnPhone)}
            onTake={() => void take()}
            onDone={() => void finish({ phase })}
          />
        </div>
      </main>
    </div>
  );
}
