// Guides, from Me (docs/prompts/tech-redesign.md, "Guides"): a library of the four kinds of visit, each its steps in
// order and the tasks each guides, and every task read-only. Drawn from the visit engine and the checklists as ops set
// them, which the phone keeps (./checklists.ts), so it opens with no signal.

import { GLYPHS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { cardStepsFor } from "@rules/policy/in-job-steps.ts";
import { VISIT_TYPES, type VisitType } from "@rules/config/visit-types.ts";
import { CardFrame } from "../frame/CardFrame.tsx";
import { guides as copy, types } from "../content.ts";
import { TaskGuide } from "../steps/index.ts";
import { screensOf, taskFor, type Screen } from "../visit/index.ts";
import { useChecklists } from "./checklists.ts";
import styles from "./guides.module.css";

/** A kind of visit's screens, in the order they are worked, as a visit of that kind would have them. */
const screensFor = (type: VisitType): Screen[] => screensOf({ type, one_visit: false, steps: cardStepsFor(type) });

export function GuidesScreen() {
  return (
    <CardFrame title={copy.title} back="/me" foot={null}>
      <ListRows className={styles.rows} label={copy.title}>
        {VISIT_TYPES.map((type) => (
          <ListRow
            key={type}
            title={types[type]}
            meta={copy.steps(screensFor(type).length)}
            to={`/guides/${type}`}
            end={<Icon d={GLYPHS.chevron} size="sm" />}
          />
        ))}
      </ListRows>
    </CardFrame>
  );
}

/** One kind of visit's guide: each step numbered, with what it is, and the tasks a step of tasks guides. */
export function GuideScreen({ type, back }: { readonly type: VisitType; readonly back: string }) {
  const screens = screensFor(type);
  const tasks = useChecklists().lists[type];
  return (
    <CardFrame title={types[type]} sub={copy.steps(screens.length)} back={back} foot={null}>
      <ol className={styles.steps}>
        {screens.map((screen) => (
          <li key={screen.id} className={styles.step}>
            <p className={styles.stepName}>{screen.title}</p>
            {screen.id === "tasks" ? (
              <ListRows className={styles.tasks} label={screen.title}>
                {tasks.map((item) => (
                  <ListRow
                    key={item.id}
                    title={taskFor(item).title}
                    to={`/guides/${type}/${item.id}`}
                    end={<Icon d={GLYPHS.chevron} size="sm" />}
                  />
                ))}
              </ListRows>
            ) : (
              <p className={styles.stepWhat}>{copy.what[screen.id]}</p>
            )}
          </li>
        ))}
      </ol>
    </CardFrame>
  );
}

/** One task, read-only: its reference, the numbered instructions and what to watch for. */
export function GuideTaskScreen({ type, task }: { readonly type: VisitType; readonly task: string }) {
  const { lists, ready } = useChecklists();
  const item = lists[type].find((each) => each.id === task);
  const screen = screensFor(type).find((each) => each.id === "tasks");
  const back = `/guides/${type}`;
  if (item === undefined) {
    if (!ready)
      return (
        <CardFrame title={types[type]} sub={copy.title} back={back} foot={null}>
          {null}
        </CardFrame>
      );
    return (
      <CardFrame title={types[type]} sub={copy.title} back={back} foot={null}>
        <p className={styles.page}>{copy.gone}</p>
      </CardFrame>
    );
  }
  const words = taskFor(item);
  return (
    <CardFrame title={words.title} sub={copy.where(types[type], screen?.title ?? "")} back={back} foot={null}>
      <div className={styles.page}>
        <TaskGuide words={words} />
      </div>
    </CardFrame>
  );
}
