// Hands the visitor a file made in the browser, such as the calendar file.

export function downloadFile(name: string, type: string, contents: BlobPart): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}
