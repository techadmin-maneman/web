// Settings › Rules: every rule ops set for themselves, a section per subject, each with one Save. A number states its
// unit and bounds, and a draft is text, never a number, since an empty box read as nought would be a radius no arrival
// passes. Each figure that moves is shown old beside new before the second press sends it.

import { Disclosure } from "@maneman/ui/Disclosure";
import { TextLink } from "@maneman/ui/TextLink";
import { errorText } from "@maneman/web-kit/refusal";
import { Panel } from "@maneman/ui/Panel";
import { Field, Fieldset, NumberInput, Select, TextInput } from "@maneman/ui/Field";
import { CheckPanel } from "../components/CheckPanel.tsx";
import { ReviewBar } from "./ReviewBar.tsx";
import { useSteps, type Sent } from "./SettingForm.tsx";
import { Button } from "@maneman/ui/Button";
import { useLoad } from "@maneman/ui/useLoad";
import { useState, type ReactNode } from "react";
import { DAY_OF_WEEK, HOUR_OF_DAY } from "@rules/config/setting-units.ts";
import { api, type ChoiceRule, type NumberRule, type OpsSetting, type SettingValue } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import { useTargetRow } from "../lib/target.ts";
import type { SectionPath } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { CHARGES_A_LATE_FEE, CONSOLE_GROUP, sectionsOf, type RuleGroupId, type RuleSection } from "./rule-groups.ts";
import form from "../components/forms.module.css";
import styles from "./rules.module.css";
import { Refusal } from "../components/Refusal.tsx";

const copy = settings.rules;

/** Where the late fees are priced. */
const PRICES_PATH: SectionPath = "/prices";

/** Each section's heading, from content.ts; typed here, so a group left unnamed fails the build. */
const GROUP_NAMES: Readonly<Record<RuleGroupId, string>> = copy.groups;

/** One rule a Save would send: the figures typed, or null to put its standard figure back. */
interface Change {
  readonly rule: OpsSetting;
  readonly value: SettingValue | null;
}

/** A rule's draft: the text in each box, or the choice, keyed as the value is. One number uses the rule's own name. */
type Draft = Readonly<Record<string, string>>;

/** Each rule's draft in a section, by the rule's name. */
type Drafts = Readonly<Record<string, Draft>>;

function keyLabel(rule: OpsSetting, key: string): string {
  if (key === "default") return copy.defaultKey;
  return copy.keyNames[rule.name]?.[key] ?? key;
}

/** The box a refusal names: "no_show_wait_min.first_fit" is First fit, and the rule's own name the rule. */
function fieldLabel(rule: OpsSetting, field: string): string {
  const [, key] = field.split(".");
  return key === undefined ? rule.title : keyLabel(rule, key);
}

function ruleRefusal(rule: OpsSetting, code: string, fields: readonly string[]): string | undefined {
  const [field, reached] = fields;
  if (code === "figures_conflict" && field !== undefined && reached !== undefined) {
    return copy.conflict(fieldLabel(rule, field), fieldLabel(rule, reached));
  }
  if (code !== "invalid_request") return errorText(copy.errors, { code });
  if (field === undefined) return copy.errors.invalid_request;
  return copy.outside(fieldLabel(rule, field));
}

/** What one box may hold, and what it counts: its key's own where the rule gives them, else the rule's. */
function boundsOf(rule: NumberRule, key: string): { min: number; max: number; unit: string } {
  return rule.bounds?.[key] ?? { min: rule.min, max: rule.max, unit: rule.unit };
}

const choiceLabel = (rule: ChoiceRule, choice: string): string => copy.choiceNames[rule.name]?.[choice] ?? choice;

const draftOf = (rule: OpsSetting): Draft =>
  typeof rule.value === "number"
    ? { [rule.name]: String(rule.value) }
    : Object.fromEntries(Object.entries(rule.value).map(([key, each]) => [key, String(each)]));

const draftIn = (drafts: Drafts, rule: OpsSetting): Draft => drafts[rule.name] ?? draftOf(rule);

const whole = (text: string, min: number, max: number): boolean => {
  const value = Number(text);
  return text.trim() !== "" && Number.isInteger(value) && value >= min && value <= max;
};

/** Whether every box holds what its key may take, so the draft can be sent. */
function isComplete(rule: OpsSetting, draft: Draft): boolean {
  if (rule.kind === "choice") {
    return Object.entries(draft).every(([key, choice]) => rule.choices[key]?.includes(choice) === true);
  }
  return Object.entries(draft).every(([key, text]) => {
    const { min, max } = boundsOf(rule, key);
    return whole(text, min, max);
  });
}

function valueOf(rule: OpsSetting, draft: Draft): SettingValue {
  if (rule.kind === "choice") return draft;
  return typeof rule.value === "number"
    ? Number(draft[rule.name])
    : Object.fromEntries(Object.entries(draft).map(([key, text]) => [key, Number(text)]));
}

/** One figure a change moves: its box, and what it reads as now and would read as after, in the console's words. */
interface Moved {
  readonly key: string;
  readonly label: string;
  readonly was: string;
  readonly now: string;
}

/** Figures read in words: an hour as the clock says it, typed on a 24-hour clock; a day by its name, 0 for Sunday. */
const READ_AS: Readonly<Record<string, { readonly say: (figure: number) => string; readonly range: string }>> = {
  [HOUR_OF_DAY]: { say: copy.hour, range: copy.allowedHours },
  [DAY_OF_WEEK]: { say: copy.weekday, range: copy.allowedDays },
};

/** "6 pm" for an hour of the day, "Monday" for a day of the week; else the figure and its unit. */
function figureWords(figure: number, unit: string): string {
  return READ_AS[unit]?.say(figure) ?? copy.confirm.figure(figure, unit);
}

/** A number as the check reads it, with its unit. Null before is a base not yet named; null after, one unnamed. */
function numberWords(rule: NumberRule, key: string, figure: number | undefined, side: "was" | "now"): string {
  if (figure !== undefined) return figureWords(figure, boundsOf(rule, key).unit);
  return side === "was" ? copy.confirm.noFigure : copy.confirm.otherBases;
}

/** A box as the check names it: a keyed rule's box with its rule, since two rules may both have a First fit box. */
const checkLabel = (rule: OpsSetting, key: string): string => copy.confirm.keyed(rule.title, keyLabel(rule, key));

/** Each figure `next` would change, in the order the boxes are shown. */
function movedBy(rule: OpsSetting, next: SettingValue): Moved[] {
  if (rule.kind === "choice") {
    const now = next as Readonly<Record<string, string>>;
    return rule.keys
      .filter((key) => rule.value[key] !== now[key])
      .map((key) => ({
        key: `${rule.name}.${key}`,
        label: checkLabel(rule, key),
        was: choiceLabel(rule, rule.value[key] ?? ""),
        now: choiceLabel(rule, now[key] ?? ""),
      }));
  }
  if (typeof rule.value === "number" || typeof next === "number") {
    const was = typeof rule.value === "number" ? rule.value : undefined;
    const now = typeof next === "number" ? next : undefined;
    if (now === undefined || was === now) return [];
    const words = (figure: number | undefined, side: "was" | "now") => numberWords(rule, rule.name, figure, side);
    return [{ key: rule.name, label: rule.title, was: words(was, "was"), now: words(now, "now") }];
  }
  const current = rule.value;
  const after = next as Readonly<Record<string, number>>;
  const keys = [...new Set([...Object.keys(current), ...Object.keys(after)])];
  return keys
    .filter((key) => current[key] !== after[key])
    .map((key) => ({
      key: `${rule.name}.${key}`,
      label: checkLabel(rule, key),
      was: numberWords(rule, key, current[key], "was"),
      now: numberWords(rule, key, after[key], "now"),
    }));
}

/** The rules whose boxes hold a figure that moves; none while any box holds what its rule cannot take. */
function changesIn(styles: readonly OpsSetting[], drafts: Drafts): Change[] {
  if (styles.some((rule) => !isComplete(rule, draftIn(drafts, rule)))) return [];
  return styles
    .map((rule) => ({ rule, value: valueOf(rule, draftIn(drafts, rule)) }))
    .filter((change) => movedBy(change.rule, change.value).length > 0);
}

/** A rule's figure: its box and its unit, with the range it may take, or why what was typed is outside it. */
function FigureField({
  label,
  bounds,
  text,
  onChange,
}: {
  label: string;
  bounds: { min: number; max: number; unit: string };
  text: string;
  onChange: (text: string) => void;
}) {
  // An hour or a day of the week is read beside its box in words.
  const reading = READ_AS[bounds.unit];
  const fits = whole(text, bounds.min, bounds.max);
  let unit = bounds.unit;
  if (reading !== undefined) unit = fits ? reading.say(Number(text)) : "";
  // A figure outside the bounds is not a change Save can send, so the box says why rather than Save going grey.
  const outside = text.trim() !== "" && !fits;
  const why =
    reading === undefined
      ? copy.outOfBounds(String(bounds.min), `${String(bounds.max)} ${bounds.unit}`)
      : copy.allowedWords(reading.say(bounds.min), reading.say(bounds.max), reading.range);
  return (
    <Field label={label} error={outside ? why : null} className={form.field}>
      {(control) => (
        <div className={form.fieldRow}>
          <NumberInput
            {...control}
            className={form.figureBox}
            inputMode="numeric"
            step={1}
            min={bounds.min}
            max={bounds.max}
            value={text}
            onChange={(event) => {
              onChange(event.target.value);
            }}
          />
          <span className={form.unit}>{unit}</span>
        </div>
      )}
    </Field>
  );
}

function ChoiceField({
  label,
  rule,
  choices,
  choice,
  onChange,
}: {
  label: string;
  rule: ChoiceRule;
  choices: readonly string[];
  choice: string;
  onChange: (choice: string) => void;
}) {
  return (
    <Field label={label} className={form.field}>
      {(control) => (
        <Select
          {...control}
          className={form.choiceBox}
          value={choice}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          {choices.map((each) => (
            <option key={each} value={each}>
              {choiceLabel(rule, each)}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/** The extra pair an open-keyed rule needs: a base, and its own cycle. */
function AddKey({ rule, onAdd }: { rule: NumberRule; onAdd: (key: string, text: string) => void }) {
  const [key, setKey] = useState("");
  const [text, setText] = useState("");
  const ready = key.trim() !== "" && whole(text, rule.min, rule.max);
  return (
    <div className={form.addKey}>
      <Field label={copy.keyName} className={form.field}>
        {(control) => (
          <TextInput
            {...control}
            className={form.text}
            maxLength={64}
            value={key}
            onChange={(event) => {
              setKey(event.target.value);
            }}
          />
        )}
      </Field>
      <Field label={copy.keyValue} className={form.field}>
        {(control) => (
          <NumberInput
            {...control}
            className={form.number}
            inputMode="numeric"
            step={1}
            min={rule.min}
            max={rule.max}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
        )}
      </Field>
      <Button
        variant="outline"
        size="small"
        className={form.quiet}
        disabled={!ready}
        onClick={() => {
          onAdd(key.trim(), text);
          setKey("");
          setText("");
        }}
      >
        {copy.add}
      </Button>
    </div>
  );
}

/** The old figure beside the new, for every one the section's change moves, before anything is sent. */
function Check({
  changes,
  busy,
  onSend,
  onBack,
}: {
  changes: readonly Change[];
  busy: boolean;
  onSend: () => void;
  onBack: () => void;
}) {
  const toStandard = changes.filter((change) => change.value === null);
  const moved = changes.flatMap(({ rule, value }) => movedBy(rule, value ?? rule.default));
  return (
    <CheckPanel
      lines={toStandard.map(({ rule }) => copy.confirm.standard(rule.title))}
      busy={busy}
      onSend={onSend}
      onBack={onBack}
    >
      <ul className={form.checkList}>
        {moved.map((each) => (
          <li key={each.key}>{copy.confirm.change(each.label, each.was, each.now)}</li>
        ))}
      </ul>
    </CheckPanel>
  );
}

/** A rule's boxes: a number's with its unit and bounds, or a choice's from those its key may take. */
function Fields({
  rule,
  draft,
  onChange,
}: {
  rule: OpsSetting;
  draft: Draft;
  onChange: (key: string, text: string) => void;
}) {
  if (rule.kind === "choice") {
    return (
      <div className={form.fields}>
        {rule.keys.map((key) => (
          <ChoiceField
            key={key}
            label={keyLabel(rule, key)}
            rule={rule}
            choices={rule.choices[key] ?? []}
            choice={draft[key] ?? ""}
            onChange={(choice) => {
              onChange(key, choice);
            }}
          />
        ))}
      </div>
    );
  }
  return (
    <div className={form.fields}>
      {Object.entries(draft).map(([key, text]) => (
        <FigureField
          key={key}
          label={typeof rule.value === "number" ? rule.title : keyLabel(rule, key)}
          bounds={boundsOf(rule, key)}
          text={text}
          onChange={(next) => {
            onChange(key, next);
          }}
        />
      ))}
    </div>
  );
}

/** A rule with more boxes than a row holds: shut until opened, so the page lists rules, not a wall of boxes. */
const MANY = 4;

function Boxes({ rule, draft, children }: { rule: OpsSetting; draft: Draft; children: ReactNode }) {
  const count = rule.kind === "choice" ? rule.keys.length : Object.keys(draft).length;
  const open = rule.kind === "number" && rule.keys === "open";
  if (count <= MANY && !open) return <>{children}</>;
  return (
    <Disclosure className={styles.many} summaryClassName={styles.summary} summary={copy.showAll(count)}>
      <div className={styles.manyBody}>{children}</div>
    </Disclosure>
  );
}

/** What the person's access lets them do here: change the rules, and open Prices, where the late fees are set. */
interface Allowed {
  readonly mayChange: boolean;
  readonly mayOpenPrices: boolean;
}

interface RuleProps {
  readonly rule: OpsSetting;
  readonly draft: Draft;
  readonly allowed: Allowed;
  /** While the section's change is checked or sent, every box holds still. */
  readonly held: boolean;
  readonly refusal: string | undefined;
  readonly onEdit: (key: string, text: string) => void;
  readonly onStandard: () => void;
}

function Rule({ rule, draft, allowed, held, refusal, onEdit, onStandard }: RuleProps) {
  const pricedInPrices = allowed.mayOpenPrices && CHARGES_A_LATE_FEE.includes(rule.name);
  const mayGoBack = allowed.mayChange && !held && rule.set_by !== null;
  return (
    <li className={form.rule} id={rule.name} tabIndex={-1}>
      {/* A rule of one figure has its name on its box, so the legend is said, not shown twice. */}
      <Fieldset
        className={form.group}
        legend={rule.title}
        legendLook={rule.kind === "number" && typeof rule.value === "number" ? "hidden" : "title"}
        disabled={held || !allowed.mayChange}
      >
        {pricedInPrices && (
          <p className={form.note}>
            <OpsLink className={form.link} to={PRICES_PATH}>
              {copy.lateFees}
            </OpsLink>
          </p>
        )}
        <Boxes rule={rule} draft={draft}>
          <Fields rule={rule} draft={draft} onChange={onEdit} />
          {allowed.mayChange && rule.kind === "number" && rule.keys === "open" && <AddKey rule={rule} onAdd={onEdit} />}
        </Boxes>
      </Fieldset>

      {mayGoBack && (
        <div className={form.actions}>
          <Button variant="outline" size="small" className={form.quiet} onClick={onStandard}>
            {copy.reset}
          </Button>
        </div>
      )}
      {refusal !== undefined && <Refusal className={form.error} said={refusal} />}
    </li>
  );
}

interface GroupSectionProps {
  readonly section: RuleSection<OpsSetting>;
  readonly allowed: Allowed;
  readonly onSaved: (saved: OpsSetting) => void;
  /** What the section shows above its rules. */
  readonly children?: ReactNode;
}

/** One subject's rules, under its own heading and anchor, reviewed and sent together. */
function GroupSection({ section, allowed, onSaved, children }: GroupSectionProps) {
  const { id, rules: styles } = section;
  const [drafts, setDrafts] = useState<Drafts>(() =>
    Object.fromEntries(styles.map((rule) => [rule.name, draftOf(rule)])),
  );
  /** What the check shows and Confirm sends: the section's changes, or one rule put back to its standard. */
  const [sending, setSending] = useState<readonly Change[]>([]);
  /** The rule a refusal stopped at, which says so beside its boxes. */
  const [refusedRule, setRefusedRule] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // One rule at a time, in the order shown: a refusal stops the rest, and says which rule it was.
  const steps = useSteps(
    async (): Promise<Sent<object>> => {
      for (const { rule, value } of sending) {
        const answer = await api.setSetting(rule.name, value);
        if (!answer.ok) {
          setRefusedRule(rule.name);
          return { ok: false as const, code: answer.code, fields: answer.fields };
        }
        setDrafts((already) => ({ ...already, [rule.name]: draftOf(answer.body) }));
        onSaved(answer.body);
      }
      return { ok: true as const };
    },
    () => {
      setSaved(true);
      steps.edit();
    },
  );

  // A figure that would not move is not a change: the log never records one that was not.
  const changes = changesIn(styles, drafts);
  const review = (these: readonly Change[]) => {
    setSending(these);
    setRefusedRule(null);
    steps.check();
  };

  const edit = (rule: OpsSetting) => (key: string, text: string) => {
    setDrafts({ ...drafts, [rule.name]: { ...draftIn(drafts, rule), [key]: text } });
    setSaved(false);
    setRefusedRule(null);
    steps.edit();
  };

  const refusalFor = (rule: OpsSetting): string | undefined => {
    if (steps.failed === null || refusedRule !== rule.name) return undefined;
    return ruleRefusal(rule, steps.failed.code, steps.failed.fields ?? []);
  };

  const titleId = `${id}-title`;
  return (
    <section className={form.ruleGroup} id={id} tabIndex={-1} aria-labelledby={titleId}>
      <h3 className={form.ruleGroupTitle} id={titleId}>
        {GROUP_NAMES[id]}
      </h3>
      {children}
      <ul className={form.rules}>
        {styles.map((rule) => (
          <Rule
            key={rule.name}
            rule={rule}
            draft={draftIn(drafts, rule)}
            allowed={allowed}
            held={steps.step !== "editing"}
            refusal={refusalFor(rule)}
            onEdit={edit(rule)}
            onStandard={() => {
              review([{ rule, value: null }]);
            }}
          />
        ))}
      </ul>

      {steps.step !== "editing" && (
        <Check changes={sending} busy={steps.step === "saving"} onSend={steps.go} onBack={steps.edit} />
      )}
      {steps.step === "editing" && allowed.mayChange && (
        <ReviewBar
          ready={changes.length > 0}
          saved={saved}
          onReview={() => {
            review(changes);
          }}
        />
      )}
    </section>
  );
}

/** What photographs and referral cards hold in R2, and the database, once read; nothing while they are not. */
function Storage() {
  const [loaded] = useLoad(api.storage);
  if (loaded.state !== "loaded") return null;
  const storage = loaded.value;
  return (
    <div className={form.storage}>
      <p>{settings.storage(storage.held_bytes, storage.share_bytes)}</p>
      <p>{settings.database(storage.database_bytes, storage.database_limit_bytes)}</p>
    </div>
  );
}

/** A link to each section, so a rule is one press away rather than a long scroll. */
function JumpList({ sections }: { sections: readonly RuleSection<OpsSetting>[] }) {
  return (
    <nav className={form.jump} aria-label={copy.jump}>
      <ul className={form.jumpList}>
        {sections.map((section) => (
          <li key={section.id}>
            <TextLink href={`#${section.id}`}>{GROUP_NAMES[section.id]}</TextLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function Rules() {
  const [loaded, retry] = useLoad(api.settings);
  /** What each rule reads as now, so "Set by" follows a save without reading the whole list again. */
  const [saved, setSaved] = useState<Readonly<Record<string, OpsSetting>>>({});
  const access = useAccess();
  const allowed: Allowed = {
    mayChange: access.mayCall("POST /api/settings/{name}"),
    mayOpenPrices: access.mayCall("GET /api/services"),
  };
  // A link to a rule or a section, as Prices' to the late-fee rule, lands on it once the rules are on the page.
  useTargetRow(loaded.state === "loaded", "start");

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const current = loaded.value.settings.map((rule) => saved[rule.name] ?? rule);
  const sections = sectionsOf(current);
  const keep = (next: OpsSetting) => {
    setSaved((already) => ({ ...already, [next.name]: next }));
  };

  return (
    <Panel titleId="rules" title={copy.title} className={form.panel}>
      <JumpList sections={sections} />
      {sections.map((section) => (
        <GroupSection key={section.id} section={section} allowed={allowed} onSaved={keep}>
          {section.id === CONSOLE_GROUP && <Storage />}
        </GroupSection>
      ))}
    </Panel>
  );
}
