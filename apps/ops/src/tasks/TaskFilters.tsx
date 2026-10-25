// What Tasks is narrowed to (./TasksScreen.tsx): a person's own, one kind, or a client found by name or number. A task
// names no city, so the board narrows by those three alone.

import { Checkbox, Field, Select } from "@maneman/ui/Field";
import { SearchInput } from "@maneman/ui/SearchInput";
import { Toolbar } from "@maneman/ui/Toolbar";
import type { TaskGroup } from "../api.ts";
import { tasks } from "../content.ts";

export interface TaskFilter {
  readonly mine: boolean;
  readonly kind: string;
  readonly search: string;
}

export const NO_FILTER: TaskFilter = { mine: false, kind: "", search: "" };

const isNarrowed = (filter: TaskFilter) => filter.mine || filter.kind !== "" || filter.search.trim() !== "";

/** The groups narrowed as asked, each counting what it shows; the board's own counts stand while nothing is. */
export function narrowed(groups: readonly TaskGroup[], filter: TaskFilter, me: string | null): TaskGroup[] {
  if (!isNarrowed(filter)) return [...groups];
  const search = filter.search.trim().toLowerCase();
  return groups
    .filter((group) => filter.kind === "" || group.group === filter.kind)
    .map((group) => {
      const left = group.tasks.filter(
        (task) =>
          (!filter.mine || task.owner === me) &&
          (search === "" || `${task.person?.name ?? ""} ${task.person?.mobile ?? ""}`.toLowerCase().includes(search)),
      );
      return { ...group, count: left.length, tasks: left };
    })
    .filter((group) => group.count > 0);
}

export function TaskFilters({ filter, onFilter }: { filter: TaskFilter; onFilter: (next: TaskFilter) => void }) {
  const words = tasks.filters;
  const kinds = Object.entries(tasks.groups).sort(([, one], [, other]) => one.localeCompare(other));
  return (
    <Toolbar label={words.label}>
      <SearchInput
        label={words.search}
        value={filter.search}
        onChange={(search) => {
          onFilter({ ...filter, search });
        }}
      />
      <Field label={words.kind} labelHidden>
        {(control) => (
          <Select
            {...control}
            width="choice"
            value={filter.kind}
            onChange={(event) => {
              onFilter({ ...filter, kind: event.currentTarget.value });
            }}
          >
            <option value="">{words.allKinds}</option>
            {kinds.map(([kind, name]) => (
              <option key={kind} value={kind}>
                {name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Checkbox
        label={words.mine}
        checked={filter.mine}
        onChange={(event) => {
          onFilter({ ...filter, mine: event.target.checked });
        }}
      />
    </Toolbar>
  );
}
