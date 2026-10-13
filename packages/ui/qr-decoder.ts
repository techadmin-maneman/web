// Camera frames read for a QR code in a worker of their own (./qr-decoder.worker.js), so the page never stalls while
// one is read (docs/decisions/0162-scanning-labels.md).

interface Decoded {
  readonly id: number;
  readonly type: string;
  readonly data: string | null;
}

interface Asked {
  readonly resolve: (text: string | null) => void;
  readonly reject: (error: Error) => void;
}

/**
 * A decoder: each frame given is read for a QR code, the text found or null. Closed with the camera. A worker that
 * fails, as one whose file a release removed, rejects each read waiting on it and every read after, so the scanner
 * says so rather than wait for ever.
 */
export function qrDecoder(): { read: (frame: ImageData) => Promise<string | null>; close: () => void } {
  const worker = new Worker(new URL("./qr-decoder.worker.js", import.meta.url));
  const waiting = new Map<number, Asked>();
  let asked = 0;
  let failed: Error | null = null;
  worker.addEventListener("message", (event: MessageEvent<Decoded>) => {
    if (event.data.type !== "qrResult") return;
    waiting.get(event.data.id)?.resolve(event.data.data);
    waiting.delete(event.data.id);
  });
  worker.addEventListener("error", (event) => {
    failed = new Error(`The QR reader did not start: ${event.message}`);
    for (const each of waiting.values()) each.reject(failed);
    waiting.clear();
  });
  return {
    read: (frame) =>
      new Promise((resolve, reject) => {
        if (failed !== null) {
          reject(failed);
          return;
        }
        asked += 1;
        waiting.set(asked, { resolve, reject });
        worker.postMessage({ id: asked, type: "decode", data: frame }, [frame.data.buffer]);
      }),
    close: () => {
      worker.terminate();
    },
  };
}
