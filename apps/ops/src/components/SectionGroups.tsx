// Sections of one job, as the navigation shows them (../route.ts, SECTION_GROUPS): one entry for the group, named for
// it, opening on the first of its sections the person may open; and, at the head of each of its pages, the group's
// sections as tabs.

import { Link } from "@maneman/ui/router";
import { Tabs, TAB } from "@maneman/ui/Tabs";
import { shell } from "../content.ts";
import { useMayCall } from "../lib/access.ts";
import { groupOf, mayOpen, SECTION_NAMES, SECTIONS, type Section, type SectionPath } from "../route.ts";
import type { Waiting } from "../tasks/decided.ts";

/** One entry of a department's list: a section on its own, or a group by its first section. */
export interface NavEntry {
  readonly key: string;
  readonly section: Section;
  readonly name: string;
  readonly current: boolean;
  readonly waiting: Waiting | undefined;
}

/** What waits across a group's sections: their counts together, overdue if any is; one section's own as it is. */
function together(waits: readonly (Waiting | undefined)[]): Waiting | undefined {
  const known = waits.filter((each): each is Waiting => each !== undefined);
  if (known.length <= 1) return known[0];
  return {
    count: known.reduce((sum, each) => sum + each.count, 0),
    overdue: known.some((each) => each.overdue),
    of: "tasks",
  };
}

/** A department's entries: each section the person may open, a group's once, in the place of its first. */
export function navEntries(
  sections: readonly Section[],
  current: SectionPath,
  waiting: ReadonlyMap<SectionPath, Waiting>,
): NavEntry[] {
  return sections.flatMap((section): NavEntry[] => {
    const group = groupOf(section.page);
    if (group === null) {
      return [
        {
          key: section.page,
          section,
          name: SECTION_NAMES[section.page],
          current: section.path === current,
          waiting: waiting.get(section.path),
        },
      ];
    }
    const members = sections.filter((each) => groupOf(each.page)?.group === group.group);
    if (members[0] !== section) return [];
    return [
      {
        key: group.group,
        section,
        name: shell.groups[group.group],
        current: members.some((each) => each.path === current),
        waiting: together(members.map((each) => waiting.get(each.path))),
      },
    ];
  });
}

/** The group's sections as tabs at the head of one of its pages; nothing for a section that stands alone. */
export function GroupTabs({ section }: { readonly section: SectionPath }) {
  const mayCall = useMayCall();
  const page = SECTIONS.find((each) => each.path === section)?.page;
  const group = page === undefined ? null : groupOf(page);
  if (group === null) return null;
  const open = SECTIONS.filter(
    (each) => (group.pages as readonly string[]).includes(each.page) && mayOpen(mayCall, each.page),
  );
  if (open.length < 2) return null;
  return (
    <Tabs label={shell.groups[group.group]}>
      {open.map((each) => (
        <Link key={each.page} className={TAB} to={each.path} current={each.path === section}>
          {SECTION_NAMES[each.page]}
        </Link>
      ))}
    </Tabs>
  );
}
