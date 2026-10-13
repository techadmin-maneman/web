/**
 * Fetches a part of an app's code that loads when it is first opened. A page left open across a release asks for a
 * file that release removed, so the page loads again, on the new release; once only, so a file that fails for any
 * other reason is not asked for in a loop.
 */
export function loadOrReload<Module>(load: () => Promise<Module>): Promise<Module> {
  return load().catch((error: unknown) => {
    if (!reloadedLately()) window.location.reload();
    throw error;
  });
}

const MARK = "mm-reloaded-for-code";
const LATELY_MS = 60_000;

/** Whether this tab was loaded again for a missing file in the last minute, marking it so if not. */
function reloadedLately(): boolean {
  try {
    const at = Number(sessionStorage.getItem(MARK) ?? 0);
    if (Date.now() - at < LATELY_MS) return true;
    sessionStorage.setItem(MARK, String(Date.now()));
  } catch {
    // Storage refused, as in a private window: loaded again all the same.
  }
  return false;
}
