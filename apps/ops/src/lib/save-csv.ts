// A CSV file handed to the browser to save, apart from ./csv.ts, which the node tests read and which has no page.

/** Hands a file to the browser to save under `name`. */
export function saveCsv(name: string, text: string): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  link.download = name;
  link.click();
  // Released once the click has been handled: released at once, some browsers cancel the download.
  setTimeout(() => {
    URL.revokeObjectURL(link.href);
  }, 0);
}
