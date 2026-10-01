// Which browser-test projects a pull request's changes can reach (docs/decisions/0006-deployment-pipeline.md, "Only
// the touched app"; the owner's choice of 1 October 2026). A file that belongs to one surface reaches that surface's
// projects alone; anything shared, the API and the packages among it, reaches them all. A staging deploy runs them all.
//
// It imports nothing from node_modules: its job installs nothing.

export const ALL_PROJECTS = ["390", "1440", "app", "ops", "tech", "tech-ios"] as const;
export type Project = (typeof ALL_PROJECTS)[number];

const SITE: readonly Project[] = ["390", "1440"];
const TECH: readonly Project[] = ["tech", "tech-ios"];

/** Paths that belong to one surface, and the projects that test it. The first that matches decides. */
const SURFACES: readonly { readonly match: RegExp; readonly projects: readonly Project[] }[] = [
  { match: /^(docs|design)\/|^[^/]+\.md$/, projects: [] },
  { match: /^e2e\/tech-staging\//, projects: [] },
  { match: /^site\//, projects: SITE },
  { match: /^apps\/app\/|^e2e\/app\//, projects: ["app"] },
  { match: /^apps\/ops\/|^e2e\/ops\//, projects: ["ops"] },
  { match: /^apps\/tech\/|^e2e\/tech\//, projects: TECH },
  { match: /^e2e\/[^/]+\.e2e\.ts$/, projects: SITE },
];

function projectsOf(path: string): readonly Project[] {
  return SURFACES.find((surface) => surface.match.test(path))?.projects ?? ALL_PROJECTS;
}

/** The projects these changed paths reach, in the order the suite lists them. */
export function touchedProjects(paths: readonly string[]): Project[] {
  const reached = new Set(paths.filter((path) => path !== "").flatMap(projectsOf));
  return ALL_PROJECTS.filter((project) => reached.has(project));
}

/** Lighthouse measures the site's pages and the client app's first screen. */
export function needsLighthouse(projects: readonly Project[]): boolean {
  return projects.some((project) => project === "390" || project === "1440" || project === "app");
}
