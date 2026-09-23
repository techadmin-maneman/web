// The camera (docs/prompts/phase2-frontend.md, "Photographs never touch the
// phone's gallery"):
//
//   - the frame comes from `getUserMedia` into a canvas, never from a file
//     input with `capture`, which on some phones saves to the camera roll;
//   - the canvas re-encodes it as JPEG, so nothing of the original file's
//     metadata survives — no location, no device, no time;
//   - it is re-encoded down to about 250 KB, the size ADR 0039's R2 budget
//     assumes for each of a visit's ten photographs;
//   - the frame then goes to the app's own store until the upload is confirmed
//     (apps/tech/src/store/outbox.ts), and never to the phone's gallery.

/** ADR 0039: "each visit's ten photographs, re-encoded on the phone to about 250 KB each". */
export const TARGET_BYTES = 250 * 1024;

/** The long edge a frame is first drawn at: enough for a scalp at arm's length, small enough to encode fast. */
const LONG_EDGE = 1600;

/** Tried in turn until the frame is at or under the target. */
const QUALITIES = [0.82, 0.72, 0.62, 0.52, 0.42] as const;

export function cameraAvailable(): boolean {
  return "mediaDevices" in navigator && typeof navigator.mediaDevices.getUserMedia === "function";
}

/** The back camera, held open for the whole of one step's five angles. */
export function openCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, width: { ideal: LONG_EDGE }, height: { ideal: LONG_EDGE } },
    audio: false,
  });
}

export function closeCamera(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) reject(new Error("the frame could not be encoded"));
        else resolve(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

/** The frame drawn at `scale`, as a canvas the same shape as the source. */
function draw(source: CanvasImageSource, width: number, height: number, scale: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("this phone has no 2d canvas");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * One tap's frame, as a JPEG at or about the target size. Quality comes down
 * first, then the frame itself, so a close-up of a scalp stays readable.
 */
export async function captureFrame(
  video: HTMLVideoElement,
  target: number = TARGET_BYTES,
): Promise<{ blob: Blob; width: number; height: number }> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (width === 0 || height === 0) throw new Error("the camera has no frame yet");

  let scale = Math.min(1, LONG_EDGE / Math.max(width, height));
  let smallest: { blob: Blob; width: number; height: number } | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const canvas = draw(video, width, height, scale);
    for (const quality of QUALITIES) {
      const blob = await encode(canvas, quality);
      const frame = { blob, width: canvas.width, height: canvas.height };
      if (smallest === null || blob.size < smallest.blob.size) smallest = frame;
      if (blob.size <= target) return frame;
    }
    scale *= 0.75;
  }
  // Nothing under the target: the smallest of what was tried, rather than nothing at all.
  if (smallest === null) throw new Error("the frame could not be encoded");
  return smallest;
}
