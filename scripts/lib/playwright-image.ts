// The Playwright images a workflow runs its jobs in, held to the version the lockfile installs
// (scripts/ci/playwright-image.ts).

const IMAGE = /mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-[a-z]+@sha256:[0-9a-f]{64}/g;

/** Why the workflow's images do not match `installed`: none named, or one of another version. Empty when they match. */
export function playwrightImageProblems(workflow: string, installed: string): string[] {
  const versions = [...workflow.matchAll(IMAGE)].map((match) => match[1]);
  if (versions.length === 0) return ["no Playwright image, pinned by its digest, is named"];
  return versions
    .filter((version) => version !== installed)
    .map(
      (version) => `the Playwright image is v${version ?? "?"}, the lockfile installs ${installed}: bump them together`,
    );
}
