// A document the API serves, as an invoice or a receipt, opened in a tab of its own once the API has answered with
// it. A document not yet raised, or gone, is said on the page, not shown as the API's refusal in a new tab. The tab
// opens on the tap, as browsers allow, and is given the file once it has come.

/** How long the file stays readable at its own address once the tab has it. */
const FILE_KEPT_MS = 60_000;

export type Opened = "opened" | "not_ready" | "failed";

export async function openDocument(url: string): Promise<Opened> {
  const tab = window.open("", "_blank");
  const response = await fetch(url, { credentials: "same-origin" }).catch(() => null);
  const blob = response?.ok === true ? await response.blob().catch(() => null) : null;
  if (response === null || blob === null) {
    tab?.close();
    return response?.status === 409 ? "not_ready" : "failed";
  }
  const file = URL.createObjectURL(blob);
  window.setTimeout(() => {
    URL.revokeObjectURL(file);
  }, FILE_KEPT_MS);
  // A browser that would not open a tab opens the file in this one.
  if (tab === null) window.location.assign(file);
  else tab.location.href = file;
  return "opened";
}
