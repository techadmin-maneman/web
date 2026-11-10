// The photograph of the door a no-show is sent with (../job/DoorScreen.tsx), on a screen of its own as the brief draws
// it ("Door and flat number in the frame"): taken as every photograph here is, from the back camera into a canvas,
// re-encoded, and kept on the phone, never in the gallery, until the outbox sends it with the close (./capture.ts,
// ../store/outbox.ts).

import { ICONS } from "@maneman/brand/icons";
import { Button } from "@maneman/ui/Button";
import { Dialog } from "@maneman/ui/Dialog";
import { IconButton } from "@maneman/ui/IconButton";
import { Shutter } from "@maneman/ui/Shutter";
import { useCamera } from "@maneman/ui/useCamera";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useCallback, useId, useRef, useState } from "react";
import { notHome } from "../content.ts";
import { captureFrame, openCamera } from "./capture.ts";
import styles from "./door-camera.module.css";

const copy = notHome.camera;

export function DoorCamera({ onTaken, onCancel }: { onTaken: (photo: Blob) => void; onCancel: () => void }) {
  // Over the door's screen, so its heading takes the focus wherever it was.
  const heading = useCallback((element: HTMLHeadingElement | null) => {
    element?.focus({ preventScroll: true });
  }, []);
  const titleId = useId();
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
    void once(async () => {
      if (video.current === null) return;
      try {
        onTaken((await captureFrame(video.current)).photo.blob);
      } catch {
        setMissed(true);
      }
    });
  return (
    <Dialog labelledBy={titleId} className={styles.overlay} canClose onDismiss={onCancel}>
      <div className={styles.screen} data-chrome="camera">
        <header className={styles.head}>
          <IconButton className={styles.close} d={ICONS.cross} size="lg" label={copy.cancel} onClick={onCancel} />
          <h2 className={styles.title} id={titleId} ref={heading} tabIndex={-1}>
            {notHome.door.photo}
          </h2>
        </header>
        <div className={styles.view}>
          {camera.state === "refused" ? (
            <div className={styles.refused}>
              <p role="alert">{copy.noCamera}</p>
              <Button variant="primary" size="action" onClick={reopen}>
                {copy.again}
              </Button>
            </div>
          ) : (
            <>
              {/* Muted and inline: a technician's phone never plays sound, and never goes full screen. */}
              <video
                className={styles.video}
                ref={attach}
                aria-label={copy.view}
                autoPlay
                muted
                playsInline
                onLoadedMetadata={() => {
                  setReady(true);
                }}
              />
              <span className={styles.guide} aria-hidden="true" />
              <p className={styles.prompt} role={missed ? "alert" : undefined}>
                {missed ? copy.missed : copy.prompt}
              </p>
            </>
          )}
        </div>
        <div className={styles.foot}>
          <Shutter label={copy.shutter} disabled={camera.state === "refused" || !ready || busy} onTake={take} />
        </div>
      </div>
    </Dialog>
  );
}
