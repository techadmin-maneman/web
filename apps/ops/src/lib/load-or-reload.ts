/**
 * Fetches a part of the console's code that loads when it is first opened. A console left open across a release asks
 * for a file that release removed, so the page loads again, on the new release.
 */
export function loadOrReload<Module>(load: () => Promise<Module>): Promise<Module> {
  return load().catch((error: unknown) => {
    window.location.reload();
    throw error;
  });
}
