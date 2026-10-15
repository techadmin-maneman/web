// The Stock page's Places panel (docs/decisions/0155-the-stock-place-tree.md). No design draws it; every word here is
// ours. Only the panel reads it, and it loads only for national managers.

import { changed, FAILED, NOT_PERMITTED, OFFLINE, UNCONFIRMED } from "./common.ts";

export const stockPlaces = {
  title: "Places",
  columns: ["Place", "Kind", "Area", ""],
  kinds: { warehouse: "Warehouse", hub: "Hub", stockroom: "Stockroom", kit: "Kit" },
  closed: "Closed",
  edit: "Edit",
  editLabel: (name: string) => `Edit ${name}`,
  add: {
    title: "Add a place",
    kind: "Kind",
    name: "Name",
    under: "Under",
    zone: "Zone",
    city: "City",
    send: "Add",
  },
  change: {
    name: "Name",
    under: "Under",
    save: "Save",
    close: "Close place",
    open: "Open again",
    cancel: "Cancel",
  },
  errors: {
    name: "Another place has that name.",
    parent_id: "Choose an open place above it.",
    zone: "Choose a zone from the list.",
    city: "Choose a city from the list.",
    active: "Empty it, and move what’s under it, first.",
    not_found: changed("That place is gone."),
    invalid_request: "Give the place a name, and choose where it sits.",
    not_permitted: NOT_PERMITTED,
    offline: OFFLINE,
    unconfirmed: UNCONFIRMED,
    unknown: FAILED,
  },
};
