// The photograph of the door a no-show is sent with (../job/NotHome.tsx), taken as every photograph here is: from the
// back camera into a canvas, re-encoded, and kept on the phone, never in the gallery, until the outbox sends it with
// the close (./capture.ts, ../store/outbox.ts).

import { Button } from "@maneman/ui/Button";
import { useCamera } from "@maneman/ui/useCamera";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useCallback, useRef, useState } from "react";
import { notHome } from "../content.ts";
import { captureFrame, openCamera } from "./capture.ts";
import styles from "./capture.module.css";

const copy = notHome.door;

export function DoorCamera({ onTaken, onCancel }: { onTaken: (photo: Blob) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [camera, reopen] = useCamera(openCamera);
  const stream = camera.state === "open" ? camera.stream : null;
  const [ready, setReady] = useState(false);
  const [missed, setMissed] = useState(false);
  const [busy, once] = useOneAtATime();
  // The camera and the element arrive in either order, so the stream is attached whichever is last.
  const attach = useCallback(
    (element: HTMLVideoElement | null) => {
      video.current = element;
      setReady(false);
      if (element !== null && stream !== null) element.srcObject = stream;
    },
    [stream],
  );
  const take = () =>
    once(async () => {
      if (video.current === null) return;
      try {
        onTaken((await captureFrame(video.current)).photo.blob);
      } catch {
        setMissed(true);
      }
    });
  if (camera.state === "refused") {
    return (
      <div className={styles.door}>
        <p role="alert">{copy.noCamera}</p>
        <Button variant="outlineOnInk" size="control" onClick={reopen}>
          {copy.again}
        </Button>
        <Button variant="outlineOnInk" size="control" onClick={onCancel}>
          {copy.cancel}
        </Button>
      </div>
    );
  }
  return (
    <div className={styles.door}>
      <div className={styles.doorView}>
        {/* Muted and inline: a technician's phone never plays sound, and never goes full screen. */}
        <video
          className={styles.view}
          ref={attach}
          aria-label={copy.view}
          autoPlay
          muted
          playsInline
          onLoadedMetadata={() => {
            setReady(true);
          }}
        />
      </div>
      {missed && <p role="alert">{copy.missed}</p>}
      <Button variant="gold" size="control" disabled={!ready || busy} busy={busy} onClick={() => void take()}>
        {copy.shutter}
      </Button>
      <Button variant="outlineOnInk" size="control" onClick={onCancel}>
        {copy.cancel}
      </Button>
    </div>
  );
}
