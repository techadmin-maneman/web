// Camera frames read for a QR code in a worker of their own (./qr-decoder.worker.js), so the page never stalls while
// one is read (docs/decisions/0162-scanning-labels.md).

interface Decoded {
  readonly id: number;
  readonly type: string;
  readonly data: string | null;
}

/** A decoder: each frame given is read for a QR code, the text found or null. Closed with the camera. */
export function qrDecoder(): { read: (frame: ImageData) => Promise<string | null>; close: () => void } {
  const worker = new Worker(new URL("./qr-decoder.worker.js", import.meta.url));
  const waiting = new Map<number, (text: string | null) => void>();
  let asked = 0;
  worker.addEventListener("message", (event: MessageEvent<Decoded>) => {
    if (event.data.type !== "qrResult") return;
    waiting.get(event.data.id)?.(event.data.data);
    waiting.delete(event.data.id);
  });
  return {
    read: (frame) =>
      new Promise((resolve) => {
        asked += 1;
        waiting.set(asked, resolve);
        worker.postMessage({ id: asked, type: "decode", data: frame }, [frame.data.buffer]);
      }),
    close: () => {
      worker.terminate();
    },
  };
}
