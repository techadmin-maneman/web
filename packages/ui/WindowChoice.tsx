// The windows a visit can start in on the day chosen, open or full. The client app's booking sheet and the site's
// /book and invite pages draw it alike, each in its own words and its own look. The site compiles it with Preact
// (site/astro.config.ts), so it uses nothing Preact lacks.

import { classes as join } from "./classes.ts";

export interface WindowOption<Id extends string> {
  readonly id: Id;
  readonly name: string;
  readonly hours: string;
  readonly open: boolean;
  /** A line beneath the hours, such as that a change this close to the visit is charged. */
  readonly note?: string | undefined;
}

type ClassName = string | undefined;

/** Each surface's own look. */
export interface WindowChoiceClasses {
  /** The fieldset, where the choice has a legend of its own. */
  readonly group?: ClassName;
  readonly legend?: ClassName;
  readonly options: ClassName;
  readonly option: ClassName;
  /** Added to the chosen option, where the look needs more than the radio's own state. */
  readonly optionOn?: ClassName;
  readonly radio: ClassName;
  /** Where the name, the hours and the note sit together in a span of their own. */
  readonly text?: ClassName;
  readonly name: ClassName;
  readonly hours: ClassName;
  readonly note?: ClassName;
  /** "Full", where it stands beneath the hours rather than in their place. */
  readonly full?: ClassName;
}

export function WindowChoice<Id extends string>(props: {
  /** The radios' name, one per form. */
  readonly name: string;
  readonly options: readonly WindowOption<Id>[];
  readonly chosen: Id | null;
  readonly fullWord: string;
  /** "Full" in place of a full window's hours, as the site draws it, rather than beneath them. */
  readonly fullInPlaceOfHours?: boolean;
  /** A legend of the choice's own; without one, `labelledBy` names the heading above it. */
  readonly legend?: string;
  readonly labelledBy?: string;
  readonly onChoose: (id: Id) => void;
  readonly classes: WindowChoiceClasses;
}) {
  const { classes, fullInPlaceOfHours = false } = props;
  const options = props.options.map((option) => {
    const lines = (
      <>
        <span className={classes.name}>{option.name}</span>
        <span className={classes.hours}>{!option.open && fullInPlaceOfHours ? props.fullWord : option.hours}</span>
        {option.note !== undefined && <span className={classes.note}>{option.note}</span>}
      </>
    );
    return (
      <label key={option.id} className={join(classes.option, option.id === props.chosen && classes.optionOn)}>
        <input
          className={classes.radio}
          type="radio"
          name={props.name}
          checked={option.id === props.chosen}
          disabled={!option.open}
          onChange={() => {
            props.onChoose(option.id);
          }}
        />
        {classes.text === undefined ? lines : <span className={classes.text}>{lines}</span>}
        {!option.open && !fullInPlaceOfHours && <span className={classes.full}>{props.fullWord}</span>}
      </label>
    );
  });
  if (props.legend === undefined) {
    return (
      <div className={classes.options} role="radiogroup" aria-labelledby={props.labelledBy}>
        {options}
      </div>
    );
  }
  return (
    <fieldset className={classes.group}>
      <legend className={classes.legend}>{props.legend}</legend>
      <div className={classes.options}>{options}</div>
    </fieldset>
  );
}
