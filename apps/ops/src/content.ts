// Every word the ops console shows, from design/phase2/Ops Console.dc.html. A
// component holds no copy of its own. Lines the design does not draw are
// ours.
//
// One file a feature, in ./content/. What is exported here is in every page's first load (vite.config.ts reads this
// list); a page loaded only when opened imports its words from its own file, so they load with it.

export * from "./content/common.ts";
export * from "./content/shell.ts";
export * from "./content/dispatch.ts";
export * from "./content/referrals.ts";
export * from "./content/clients.ts";
export * from "./content/areas.ts";
export * from "./content/no-shows.ts";
export * from "./content/tasks.ts";
export * from "./content/technicians.ts";
export * from "./content/decisions.ts";
// Settings' screens import their words from ./content/settings.ts; the every-page part is here.
export * from "./content/settings-shell.ts";
export * from "./content/cities.ts";
