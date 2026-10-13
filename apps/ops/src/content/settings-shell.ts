// The Settings words the console needs on every page: the tabs' names, which the navigation and the titles read, and
// how a grant is said, which the shell reads for access. The rest load with Settings' screens (./settings.ts).

import { DEPARTMENT_NAMES } from "./shell.ts";

export const settingsTabs = {
  rules: "Policies",
  blackouts: "Closed days",
  "job-sheet": "Job sheet",
};

/** "Customer Care · Act · National" */
export const grantPhrasing = {
  departments: DEPARTMENT_NAMES,
  levels: { view: "View", act: "Act", manage: "Manage" },
  national: "National",
  zone: (name: string) => `${name} zone`,
  grant: (department: string, level: string, place: string) => `${department} · ${level} · ${place}`,
};
