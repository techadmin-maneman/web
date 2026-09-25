// The camera, held open only while the capture screen is in front of the
// technician (board B1).
//
// A phone that goes to the background keeps its camera busy for nothing, and
// an iPhone hands back a black or frozen picture when it returns to a stream
// it held all along. A track can also end on its own — another app took the
// camera, or the system did. So the camera is let go whenever the app is
// hidden, opened afresh when it comes back, and opened again when its track
// ends. A refusal is not the end either: `retry` asks again.

import { useCallback, useEffect, useState } from "react";
import { cameraAvailable, closeCamera, openCamera } from "./capture.ts";

export type Camera =
  | { readonly state: "opening" }
  | { readonly state: "open"; readonly stream: MediaStream }
  | { readonly state: "refused" };

function useVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const changed = () => {
      setVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", changed);
    return () => {
      document.removeEventListener("visibilitychange", changed);
    };
  }, []);
  return visible;
}

export function useCamera(): readonly [Camera, () => void] {
  const [camera, setCamera] = useState<Camera>({ state: "opening" });
  const [attempt, setAttempt] = useState(0);
  const visible = useVisible();

  const retry = useCallback(() => {
    setAttempt((count) => count + 1);
  }, []);

  useEffect(() => {
    setCamera({ state: "opening" });
    // Hidden: the camera was let go when this effect last cleaned up, and is opened again on the way back.
    if (!visible) return;
    if (!cameraAvailable()) {
      setCamera({ state: "refused" });
      return;
    }
    let current = true;
    let opened: MediaStream | null = null;
    void openCamera().then(
      (stream) => {
        opened = stream;
        if (!current) {
          closeCamera(stream);
          return;
        }
        for (const track of stream.getVideoTracks()) track.addEventListener("ended", retry);
        setCamera({ state: "open", stream });
      },
      () => {
        if (current) setCamera({ state: "refused" });
      },
    );
    return () => {
      current = false;
      closeCamera(opened);
    };
  }, [visible, attempt, retry]);

  return [camera, retry];
}
