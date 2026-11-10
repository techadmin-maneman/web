// The parts page: every part the redesigned screens are built from, in the new look (../styles/look.css) and in each
// of its states, for the screenshots each redesign PR takes at 360 and 390 px and for anyone building a screen to look
// up. It is built into local builds alone (../main.tsx), so no staging or production phone carries it. It calls no API.

import { ActionBar } from "@maneman/ui/ActionBar";
import { Button } from "@maneman/ui/Button";
import { Checkbox, ChoiceGroup, Field, Radio, TextInput } from "@maneman/ui/Field";
import { ProblemCard } from "@maneman/ui/ProblemCard";
import { ProgressLine, StepProgress, stepStates } from "@maneman/ui/Progress";
import { SectionHead } from "@maneman/ui/SectionHead";
import { Stepper } from "@maneman/ui/Stepper";
import { ToggleButton } from "@maneman/ui/ToggleButton";
import { typeLook } from "@maneman/ui/type";
import { useState } from "react";
import { parts as words } from "./words.ts";
import styles from "./parts.module.css";

function Buttons() {
  return (
    <section aria-labelledby="parts-buttons">
      <SectionHead id="parts-buttons" title={words.buttons.head} />
      <div className={styles.stack}>
        <Button variant="primary" size="action">
          {words.buttons.primary}
        </Button>
        <Button variant="primary" size="action" disabled>
          {words.buttons.disabled}
        </Button>
        <Button variant="primary" size="action" busy>
          {words.buttons.busy}
        </Button>
        <div className={styles.row}>
          <Button variant="quiet" size="control">
            {words.buttons.secondary}
          </Button>
          <Button variant="outline" size="control">
            {words.buttons.outline}
          </Button>
        </div>
        <div className={styles.row}>
          <Button variant="danger" size="control">
            {words.buttons.danger}
          </Button>
          <Button variant="destructive" size="control">
            {words.buttons.destructive}
          </Button>
        </div>
      </div>
    </section>
  );
}

function Fields() {
  return (
    <section aria-labelledby="parts-fields">
      <SectionHead id="parts-fields" title={words.fields.head} />
      <div className={styles.stack}>
        <Field label={words.fields.number} hint={words.fields.numberHint}>
          {(control) => <TextInput {...control} inputMode="numeric" defaultValue="98110 00000" />}
        </Field>
        <Field label={words.fields.note} error={words.fields.error}>
          {(control) => <TextInput {...control} defaultValue="98110" />}
        </Field>
      </div>
    </section>
  );
}

function Choices() {
  const [answer, setAnswer] = useState("yes");
  const [done, setDone] = useState(true);
  const [reason, setReason] = useState<string>(words.choices.reason[1]);
  return (
    <section aria-labelledby="parts-choices">
      <SectionHead id="parts-choices" title={words.choices.head} />
      <div className={styles.stack}>
        <ChoiceGroup legend={words.choices.legend} legendLook="title" ruled>
          <Radio
            name="parts-fit"
            label={words.choices.yes}
            detail={words.choices.yesDetail}
            checked={answer === "yes"}
            onChange={() => {
              setAnswer("yes");
            }}
          />
          <Radio
            name="parts-fit"
            label={words.choices.no}
            checked={answer === "no"}
            onChange={() => {
              setAnswer("no");
            }}
          />
        </ChoiceGroup>
        <Checkbox
          label={words.choices.tick}
          checked={done}
          onChange={() => {
            setDone(!done);
          }}
        />
        <p className={typeLook("body", styles.label)}>{words.choices.reasons}</p>
        <div className={styles.chips} role="radiogroup" aria-label={words.choices.reasons}>
          {words.choices.reason.map((each) => (
            <ToggleButton
              key={each}
              asRadio
              filled
              pressed={reason === each}
              onClick={() => {
                setReason(each);
              }}
            >
              {each}
            </ToggleButton>
          ))}
        </div>
      </div>
    </section>
  );
}

function Counts() {
  const [count, setCount] = useState(3);
  return (
    <section aria-labelledby="parts-stepper">
      <SectionHead id="parts-stepper" title={words.stepper.head} />
      <div className={styles.counted}>
        <div>
          <p className={styles.name}>{words.stepper.name}</p>
          <p className={styles.meta}>{words.stepper.usual}</p>
        </div>
        <Stepper
          value={count}
          onChange={setCount}
          max={46}
          lessLabel={words.stepper.less}
          moreLabel={words.stepper.more}
          said={words.stepper.said(count)}
        />
      </div>
    </section>
  );
}

function Progress() {
  return (
    <section aria-labelledby="parts-progress">
      <SectionHead id="parts-progress" title={words.progress.head} />
      <div className={styles.stack}>
        <div>
          <StepProgress steps={stepStates(6, 2)} />
          <p className={styles.apart}>
            <span>{words.progress.steps(3, 6)}</span>
            <span className={styles.strong}>{words.progress.all}</span>
          </p>
        </div>
        <div className={styles.line}>
          <ProgressLine value={0.5} />
          <span className={styles.meta}>{words.progress.scanned}</span>
        </div>
        <div className={styles.line}>
          <ProgressLine value={0.4} tone="accent" />
          <span className={styles.meta}>{words.progress.wait}</span>
        </div>
      </div>
    </section>
  );
}

function Problems() {
  return (
    <section aria-labelledby="parts-problems">
      <SectionHead id="parts-problems" title={words.problems.head} />
      <div className={styles.stack}>
        <ProblemCard title={words.problems.unsent} onOpen={() => undefined}>
          {words.problems.unsentBody}
        </ProblemCard>
        <ProblemCard title={words.problems.rejected}>{words.problems.rejectedBody}</ProblemCard>
      </div>
    </section>
  );
}

export function PartsScreen() {
  return (
    <div className={styles.screen} data-look="light">
      <main className={styles.body}>
        <h1 className={typeLook("title-2", styles.title)}>{words.title}</h1>
        <p className={styles.meta}>{words.intro}</p>
        <section aria-labelledby="parts-type">
          <SectionHead id="parts-type" title={words.type.head} />
          <p className={typeLook("title-2", styles.title)}>{words.type.screen}</p>
          <SectionHead level={3} title={words.type.section} ruled={false} />
          <SectionHead level={3} size="list" title={words.type.list} />
          <p className={typeLook("body-large")}>{words.type.body}</p>
          <p className={styles.meta}>{words.type.meta}</p>
        </section>
        <Buttons />
        <Fields />
        <Choices />
        <Counts />
        <Progress />
        <Problems />
        <section aria-labelledby="parts-hindi" lang="hi">
          <SectionHead id="parts-hindi" title={words.hindi.head} />
          <p className={typeLook("body-large")}>{words.hindi.body}</p>
        </section>
      </main>
      <ActionBar helper={words.bar.helper}>
        {(helperId) => (
          <Button variant="primary" size="action" disabled aria-describedby={helperId}>
            {words.bar.action}
          </Button>
        )}
      </ActionBar>
    </div>
  );
}
