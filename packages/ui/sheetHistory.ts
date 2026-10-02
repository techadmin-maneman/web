// An open sheet's own entry in the browser's history, so Back closes the sheet
// instead of leaving the page under it. The entry keeps the page's address and
// carries the sheet's number. It is taken out again as the sheet leaves the
// page, unless a sheet drawn in its place takes it over, or a move to another
// page has taken its place.

const MARK = "sheet";

/** How long a move, or a sheet opening, waits for a sheet's entry to go, should the browser never say it has. */
const WAIT_MS = 500;

let lastNumber = 0;
const openSheets = new Set<number>();
let steppingBack: Promise<void> | null = null;

/** The number of the sheet whose entry the history is at; null at any other entry. */
function sheetAt(): number | null {
  const state: unknown = window.history.state;
  if (typeof state !== "object" || state === null) return null;
  const number = (state as Record<string, unknown>)[MARK];
  return typeof number === "number" ? number : null;
}

/** True at an entry a sheet put in the history. */
export const atSheetEntry = (): boolean => sheetAt() !== null;

/** Steps back off a sheet's entry, remembering it is doing so until the browser says it has. */
function stepBack(): void {
  steppingBack = new Promise((resolve) => {
    const done = () => {
      window.removeEventListener("popstate", done);
      window.clearTimeout(timer);
      steppingBack = null;
      resolve();
    };
    const timer = window.setTimeout(done, WAIT_MS);
    window.addEventListener("popstate", done);
  });
  window.history.back();
}

/** Runs `change` once no sheet's entry is still being taken out, so that step back cannot undo the change. */
export function afterSheets(change: () => void): void {
  if (steppingBack === null) change();
  else void steppingBack.then(change);
}

/** Puts sheet `number`'s entry in the history: the one a sheet that has left the page put there, or a new one. */
function putEntry(number: number): void {
  const left = sheetAt();
  if (left !== null && !openSheets.has(left)) window.history.replaceState({ [MARK]: number }, "");
  else window.history.pushState({ [MARK]: number }, "");
}

/**
 * Gives an open sheet its entry in the history, once any sheet's entry on its way out has gone. `onBack` runs when
 * Back steps off it. Call the answer as the sheet leaves the page.
 */
export function enterSheet(onBack: () => void): () => void {
  lastNumber += 1;
  const number = lastNumber;
  openSheets.add(number);
  let page = "";
  let inHistory = false;

  const onPop = () => {
    if (!inHistory || sheetAt() === number) return;
    inHistory = false;
    // A move to another page took the entry's place: the page goes, and the sheet with it.
    if (window.location.href === page) onBack();
  };
  afterSheets(() => {
    if (!openSheets.has(number)) return;
    page = window.location.href;
    putEntry(number);
    inHistory = true;
    window.addEventListener("popstate", onPop);
  });

  return () => {
    openSheets.delete(number);
    window.removeEventListener("popstate", onPop);
    // Once this render is over, so that a sheet drawn in this one's place can take the entry first.
    queueMicrotask(() => {
      if (sheetAt() === number) stepBack();
    });
  };
}
