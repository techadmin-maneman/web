// Every word the ops console shows, from design/phase2/Ops Console.dc.html. A
// component holds no copy of its own. Lines the design does not draw are
// ours.
//
// One file a feature, in ./content/; a screen imports its words from here. Activity, loaded only when opened, imports
// its own from ./content/activity.ts, so its eighty lines are not in every page's first load.

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
export * from "./content/settings.ts";
export * from "./content/stock.ts";
