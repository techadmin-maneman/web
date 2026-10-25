// The camera's torch, for a basement or a dim room: offered only where the back camera says it has one, as most
// Android phones' do and no iPhone's in a browser does.

import { ToggleButton } from "@maneman/ui/ToggleButton";
import { useEffect, useState } from "react";
import { capture as copy } from "../content.ts";
import styles from "./capture.module.css";

/** What a camera that has a torch says of itself; the DOM's own types do not list it yet. */
type WithTorch = MediaTrackCapabilities & { readonly torch?: boolean };

function torchOf(stream: MediaStream | null): MediaStreamTrack | null {
  const track = stream?.getVideoTracks()[0];
  if (track === undefined || typeof track.getCapabilities !== "function") return null;
  return (track.getCapabilities() as WithTorch).torch === true ? track : null;
}

export function Torch({ stream }: { readonly stream: MediaStream | null }) {
  const track = torchOf(stream);
  const [on, setOn] = useState(false);

  // A new stream opens with its torch off.
  useEffect(() => {
    setOn(false);
  }, [stream]);

  if (track === null) return null;
  const turn = (to: boolean) => {
    track.applyConstraints({ advanced: [{ torch: to } as MediaTrackConstraintSet] }).then(
      () => {
        setOn(to);
      },
      () => {
        // A torch the camera would not light stays as it was.
      },
    );
  };
  return (
    <ToggleButton
      onInk
      className={styles.torch}
      pressed={on}
      onClick={() => {
        turn(!on);
      }}
    >
      {copy.torch}
    </ToggleButton>
  );
}
