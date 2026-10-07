// What Activity's address narrows the log to (apps/ops/src/activity/filters.ts): a link carries it, a value the API
// would refuse is left out, and the API is asked with only what is set.

import { describe, expect, it } from "vitest";
import { activityPath, askedOf, filtersOf } from "../../../apps/ops/src/activity/filters.ts";

const CLIENT = "22000000-0000-4000-8000-000000000001";

describe("Activity's filters", () => {
  it("are carried in the page's address, and read back from it", () => {
    const path = activityPath({ person: CLIENT, action: "visit.cancel", from: "2026-10-01" });

    expect(path).toBe(`/activity?person=${CLIENT}&action=visit.cancel&from=2026-10-01`);
    expect(filtersOf(path.slice("/activity".length))).toMatchObject({
      person: CLIENT,
      action: "visit.cancel",
      from: "2026-10-01",
    });
  });

  it("are the whole log at /activity", () => {
    expect(activityPath({})).toBe("/activity");
  });

  it("leave out what the API would refuse: an unknown kind or action, or a date of another form", () => {
    const filters = filtersOf(
      "?actor_kind=robot&action=visit.explode&from=1%20Oct&to=2026-10-07&actor=%20care%40maneman.in%20",
    );

    expect(filters).toEqual({
      actor_kind: undefined,
      actor: "care@maneman.in",
      action: undefined,
      person: undefined,
      visit: undefined,
      from: undefined,
      to: "2026-10-07",
    });
  });

  it("ask the API with only what is set, and the page to go on from", () => {
    expect(askedOf({ person: CLIENT, actor: undefined }, 120)).toEqual({ person: CLIENT, before: 120 });
  });
});
