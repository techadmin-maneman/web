// The bar over Tasks (./TasksScreen.tsx): its views, each with how many it holds (./task-views.ts), one kind, and a
// client found by name or number. On a phone the views are a row of chips.

import { Field, Select } from "@maneman/ui/Field";
import { SearchInput } from "@maneman/ui/SearchInput";
import { ToggleButton } from "@maneman/ui/ToggleButton";
import { Toolbar } from "@maneman/ui/Toolbar";
import { tasks } from "../content.ts";
import styles from "./task-filters.module.css";
import { TASK_VIEWS, type TaskFilter, type TaskView } from "./task-views.ts";

export function TaskFilters(props: {
  filter: TaskFilter;
  counts: Readonly<Record<TaskView, number>>;
  onFilter: (next: TaskFilter) => void;
}) {
  const { filter, onFilter } = props;
  const words = tasks.filters;
  const kinds = Object.entries(tasks.groups).sort(([, one], [, other]) => one.localeCompare(other));
  return (
    <Toolbar
      label={words.label}
      end={
        <SearchInput
          label={words.search}
          value={filter.search}
          onChange={(search) => {
            onFilter({ ...filter, search });
          }}
        />
      }
    >
      <div className={styles.views} role="radiogroup" aria-label={words.label}>
        {TASK_VIEWS.map((view) => (
          <ToggleButton
            key={view}
            asRadio
            filled
            pressed={filter.view === view}
            count={props.counts[view]}
            onClick={() => {
              onFilter({ ...filter, view });
            }}
          >
            {words.views[view]}
          </ToggleButton>
        ))}
      </div>
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
    </Toolbar>
  );
}
