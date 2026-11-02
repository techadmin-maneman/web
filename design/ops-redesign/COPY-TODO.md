# Ops console redesign — words waiting for the owner

Each slot the redesign adds where the console has no string of its own to put. Its content key holds `TODO(copy)`, and the slot shows nothing until the owner writes its words (ADR 0225). Nothing here is taken from the design files.

| Screen | Slot                                         | What it is for                                                          | Content key           |
| ------ | -------------------------------------------- | ----------------------------------------------------------------------- | --------------------- |
| Header | The search panel's heading over pages found  | Names the pages and Settings' pages beneath the clients and technicians | `shell.palette.pages` |

## Taken from the brief, to confirm

The brief of 2 November 2026 names these itself, so they stand in content as its words, not the design files'. A tab with no name would also be unnamed to a screen reader.

| Screen     | Slot                          | Words                                             | Content key                   |
| ---------- | ----------------------------- | ------------------------------------------------- | ----------------------------- |
| Navigation | The four groups' names        | Work, People, Running the business, Admin         | `shell.navGroups`             |
| Phone      | The tab bar's last tab, and the page it opens | More                              | `shell.more`                  |
