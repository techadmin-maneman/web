// The camera (docs/prompts/phase2-frontend.md, "Photographs never touch the
// phone's gallery"):
//
//   - the frame comes from `getUserMedia` into a canvas, never from a file
//     input with `capture`, which on some phones saves to the camera roll;
//   - the canvas re-encodes it as JPEG, so nothing of the original file's
//     metadata survives — no location, no device, no time;
//   - it is re-encoded down to about 250 KB, the size ADR 0039's R2 budget
//     assumes for each of a visit's ten photographs, as the site re-encodes a
//     try-on photograph's small copy (@maneman/web-kit/small-jpeg);
//   - a thumbnail of the same frame, 300 px on its short side, goes with it,
//     for the client app's rows (docs/decisions/0093-the-storage-meter.md);
//   - the frame then goes to the app's own store until the upload is confirmed
//     (apps/tech/src/store/outbox.ts), and never to the phone's gallery.

import { SMALL_JPEG_LONG_EDGE, smallJpeg, still, thumbnailJpeg, type SmallJpeg } from "@maneman/web-kit/small-jpeg";

export function cameraAvailable(): boolean {
  return "mediaDevices" in navigator && typeof navigator.mediaDevices.getUserMedia === "function";
}

/** The back camera, held open for the whole of one step's five angles. */
export function openCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: SMALL_JPEG_LONG_EDGE },
      height: { ideal: SMALL_JPEG_LONG_EDGE },
    },
    audio: false,
  });
}

export function closeCamera(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

export interface Captured {
  /** The photograph, at or about 250 KB. */
  readonly photo: SmallJpeg;
  /** Its thumbnail, from the same frame. */
  readonly small: SmallJpeg;
}

/** One tap's frame, held still so the photograph and its thumbnail are the same moment. */
export async function captureFrame(video: HTMLVideoElement): Promise<Captured> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (width === 0 || height === 0) throw new Error("the camera has no frame yet");
  const frame = still(video, width, height);
  return {
    photo: await smallJpeg(frame, frame.width, frame.height),
    small: await thumbnailJpeg(frame, frame.width, frame.height),
  };
}
