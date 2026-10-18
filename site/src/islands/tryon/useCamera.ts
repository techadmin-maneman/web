// The front camera, opened in the page, so "Use the camera" takes a photo there and then on any device with one. A
// file input's `capture` is ignored at a desk and by some phone browsers, which open the file picker instead. Where the
// page cannot open a camera (no camera, permission refused, an old browser), `start` says so and the caller falls back
// to that input.

import { useEffect, useRef, useState } from "preact/hooks";

/** The size asked of the camera; the photo is made smaller before it is sent, like any other. */
const PHOTO_LONG_SIDE = 1280;

/** The camera as the upload step holds it. */
export type Camera = ReturnType<typeof useCamera>;

export function useCamera() {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  /** False once the device is known to have no camera, so the button is not offered. */
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    const devices = navigator.mediaDevices as MediaDevices | undefined;
    if (devices?.enumerateDevices === undefined) return;
    devices
      .enumerateDevices()
      .then((found) => {
        setAvailable(found.some((device) => device.kind === "videoinput"));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (video.current !== null) video.current.srcObject = stream;
    return () => {
      stream?.getTracks().forEach((track) => {
        track.stop();
      });
    };
  }, [stream]);

  /** Opens the camera; false where the page cannot, so the caller offers the file input instead. */
  async function start(): Promise<boolean> {
    const devices = navigator.mediaDevices as MediaDevices | undefined;
    if (devices?.getUserMedia === undefined) return false;
    try {
      const opened = await devices.getUserMedia({
        video: { facingMode: "user", width: { ideal: PHOTO_LONG_SIDE }, height: { ideal: PHOTO_LONG_SIDE } },
        audio: false,
      });
      setStream(opened);
      return true;
    } catch {
      return false;
    }
  }

  function close() {
    setStream(null);
  }

  /** The frame the camera shows now, as a JPEG file, and the camera closed; it waits for the first frame. */
  async function take(): Promise<File | null> {
    const frame = video.current;
    if (frame === null) return null;
    if (frame.videoWidth === 0) {
      await new Promise((ready) => {
        frame.addEventListener("loadeddata", ready, { once: true });
      });
    }
    const canvas = document.createElement("canvas");
    canvas.width = frame.videoWidth;
    canvas.height = frame.videoHeight;
    canvas.getContext("2d")?.drawImage(frame, 0, 0);
    const blob = await new Promise<Blob | null>((done) => {
      canvas.toBlob(done, "image/jpeg", 0.92);
    });
    close();
    return blob === null ? null : new File([blob], "camera.jpg", { type: "image/jpeg" });
  }

  return { video, open: stream !== null, available, start, close, take };
}
