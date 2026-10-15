// The windows a visit can start in on the day chosen, open or full, each a card to choose (./ChoiceCard.tsx). The
// client app's booking sheet and the site's /book and invite pages draw it alike, in one look; the site compiles it
// with Preact (site/astro.config.ts), so it uses nothing Preact lacks.

import { CARD_NOTE, ChoiceCard } from "./ChoiceCard.tsx";
import { Fieldset } from "./Field.tsx";
import { classes } from "./classes.ts";
import styles from "./window-choice.module.css";

export interface WindowOption<Id extends string> {
  readonly id: Id;
  readonly name: string;
  readonly hours: string;
  readonly open: boolean;
  /** A line beneath the hours, such as that a change this close to the visit is charged. */
  readonly note?: string | undefined;
}

export function WindowChoice<Id extends string>(props: {
  /** The radios' name, one per form. */
  readonly name: string;
  readonly options: readonly WindowOption<Id>[];
  readonly chosen: Id | null;
  /** Said in place of a full window's hours, on every surface. */
  readonly fullWord: string;
  /** A legend of the choice's own; without one, `labelledBy` names the heading above it. */
  readonly legend?: string;
  readonly labelledBy?: string;
  readonly onChoose: (id: Id) => void;
  /** The choice's place on its screen. */
  readonly className?: string | undefined;
}) {
  const options = props.options.map((option) => (
    <ChoiceCard
      key={option.id}
      name={props.name}
      checked={option.id === props.chosen}
      disabled={!option.open}
      onChange={() => {
        props.onChoose(option.id);
      }}
    >
      <span className={styles.text}>
        <span className={styles.name}>{option.name}</span>
        <span className={classes(styles.hours, CARD_NOTE)}>{option.open ? option.hours : props.fullWord}</span>
        {option.note !== undefined && <span className={classes(styles.hours, styles.late)}>{option.note}</span>}
      </span>
    </ChoiceCard>
  ));
  if (props.legend === undefined) {
    return (
      <div className={classes(styles.options, props.className)} role="radiogroup" aria-labelledby={props.labelledBy}>
        {options}
      </div>
    );
  }
  return (
    <Fieldset className={props.className} legend={props.legend}>
      <div className={styles.options}>{options}</div>
    </Fieldset>
  );
}
