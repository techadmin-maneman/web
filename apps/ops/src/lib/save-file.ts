// A file the console makes, handed to the browser to save: a CSV or a QR code. Apart from ./csv.ts, which the node
// tests read and which has no page.

/** Hands `text` to the browser to save as `name`, of the given media type. */
export function saveFile(name: string, text: string, type: "text/csv" | "image/svg+xml"): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = name;
  link.click();
  // Released once the click has been handled: released at once, some browsers cancel the download.
  setTimeout(() => {
    URL.revokeObjectURL(link.href);
  }, 0);
}

/** Hands an SVG to the browser to save as a PNG `size` pixels square, drawn from it on a canvas. */
export async function saveSvgAsPng(name: string, svg: string, size: number): Promise<void> {
  const source = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image(size, size);
    image.src = source;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    canvas.getContext("2d")?.drawImage(image, 0, 0, size, size);
    const png = await new Promise<Blob | null>((done) => {
      canvas.toBlob(done, "image/png");
    });
    if (png === null) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(png);
    link.download = name;
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(link.href);
    }, 0);
  } finally {
    URL.revokeObjectURL(source);
  }
}
