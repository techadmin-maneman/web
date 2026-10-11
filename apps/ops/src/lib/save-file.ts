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
