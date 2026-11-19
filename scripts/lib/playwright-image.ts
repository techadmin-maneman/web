// The Playwright images a workflow runs its jobs in, held to the version the lockfile installs
// (scripts/ci/playwright-image.ts).

const IMAGE = /mcr\.microsoft\.com\/playwright(?::([^\s@"']+))?(@sha256:[0-9a-f]{64})?/g;

/**
 * Why the workflow's images do not match `installed`: none named, one not pinned by its digest, or one of another
 * version. Empty when they match.
 */
export function playwrightImageProblems(workflow: string, installed: string): string[] {
  const images = [...workflow.matchAll(IMAGE)].map(([image, tag, digest]) => ({ image, tag, digest }));
  if (images.length === 0) return ["no Playwright image is named"];
  const problems: string[] = [];
  for (const { image, tag, digest } of images) {
    if (digest === undefined) problems.push(`${image} is not pinned by its digest`);
    const version = /^v(.+?)-[a-z]+$/.exec(tag ?? "")?.[1];
    if (version !== installed)
      problems.push(
        `the Playwright image is ${tag ?? "untagged"}, the lockfile installs ${installed}: bump them together`,
      );
  }
  return problems;
}
