// Settings › Rules: every rule ops set for themselves, a section per subject, each section with one Save.
//
// A rule is numbers or choices. Every number says its unit and its bounds
// before anything is typed, each box its own where a rule's figures differ, and
// a refusal names the box it came from, which the API gives as the rule's name
// or as "rule.key". A draft is held as text, never as a number: an empty box
// would read as nought, and a nought here is a radius no arrival can pass or a
// cycle due the day it is fitted. A choice is picked from those its key may
// take, each in the console's words.
//
// Nothing is sent until ops have seen the change: each figure that moves, the
// old beside the new, and only the second press sends it, as a price is set.

import { Button } from "@maneman/ui/Button";
import { useLoad } from "@maneman/ui/useLoad";
import { longDate } from "@maneman/web-kit/dates";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, type ChoiceRule, type NumberRule, type OpsSetting, type SettingValue } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { settings } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { useTargetRow } from "../lib/target.ts";
import type { SectionPath } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { CHARGES_A_LATE_FEE, CONSOLE_GROUP, sectionsOf, type RuleGroupId, type RuleSection } from "./rule-groups.ts";
import styles from "./settings.module.css";

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

/** How a section's form is going. A refusal keeps the rule it came from, so it shows under that rule. */
type Saving =
  | { readonly step: "editing" | "saved" }
  | { readonly step: "checking" | "saving"; readonly changes: readonly Change[] }
  | { readonly step: "failed"; readonly rule: string; readonly code: string; readonly fields: readonly string[] };

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

function refusalOf(rule: OpsSetting, code: string, fields: readonly string[]): string | undefined {
  const [field] = fields;
  if (code !== "invalid_request") return copy.errors[code] ?? copy.errors.unknown;
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

/** A number as the check reads it, with its unit. Null before is a base not yet named; null after, one unnamed. */
function numberWords(rule: NumberRule, key: string, figure: number | undefined, side: "was" | "now"): string {
  if (figure !== undefined) return copy.confirm.figure(figure, boundsOf(rule, key).unit);
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
function changesIn(rules: readonly OpsSetting[], drafts: Drafts): Change[] {
  if (rules.some((rule) => !isComplete(rule, draftIn(drafts, rule)))) return [];
  return rules
    .map((rule) => ({ rule, value: valueOf(rule, draftIn(drafts, rule)) }))
    .filter((change) => movedBy(change.rule, change.value).length > 0);
}

function Field({
  id,
  label,
  bounds,
  text,
  onChange,
}: {
  id: string;
  label: string;
  bounds: { min: number; max: number; unit: string };
  text: string;
  onChange: (text: string) => void;
}) {
  const hint = `${id}-allowed`;
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {label}
      </label>
      <div className={styles.fieldRow}>
        <input
          className={styles.number}
          id={id}
          type="number"
          inputMode="numeric"
          step={1}
          min={bounds.min}
          max={bounds.max}
          value={text}
          aria-describedby={hint}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
        <span className={styles.unit}>{bounds.unit}</span>
      </div>
      <p className={styles.hint} id={hint}>
        {copy.allowed(bounds.min, bounds.max, bounds.unit)}
      </p>
    </div>
  );
}

function ChoiceField({
  id,
  label,
  rule,
  choices,
  choice,
  onChange,
}: {
  id: string;
  label: string;
  rule: ChoiceRule;
  choices: readonly string[];
  choice: string;
  onChange: (choice: string) => void;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {label}
      </label>
      <select
        className={styles.select}
        id={id}
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
      </select>
    </div>
  );
}

/** The extra pair an open-keyed rule needs: a base, and its own cycle. */
function AddKey({ rule, onAdd }: { rule: NumberRule; onAdd: (key: string, text: string) => void }) {
  const [key, setKey] = useState("");
  const [text, setText] = useState("");
  const ready = key.trim() !== "" && whole(text, rule.min, rule.max);
  return (
    <div className={styles.addKey}>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={`${rule.name}-new-key`}>
          {copy.keyName}
        </label>
        <input
          className={styles.text}
          id={`${rule.name}-new-key`}
          type="text"
          maxLength={64}
          value={key}
          onChange={(event) => {
            setKey(event.target.value);
          }}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={`${rule.name}-new-value`}>
          {copy.keyValue}
        </label>
        <input
          className={styles.number}
          id={`${rule.name}-new-value`}
          type="number"
          inputMode="numeric"
          step={1}
          min={rule.min}
          max={rule.max}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </div>
      <Button
        variant="outline"
        size="small"
        className={styles.quiet}
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

/** Who set a rule and when, or that nobody has. */
function setLine(rule: OpsSetting): string {
  if (rule.set_by === null || rule.set_at === null) return copy.committed;
  return copy.setBy(rule.set_by, longDate(rule.set_at));
}

/** The old figure beside the new, for every one the section's change moves, before anything is sent. */
function Check({
  id,
  changes,
  busy,
  onSend,
  onBack,
}: {
  id: string;
  changes: readonly Change[];
  busy: boolean;
  onSend: () => void;
  onBack: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  const title = `${id}-check`;
  const toStandard = changes.filter((change) => change.value === null);
  const moved = changes.flatMap(({ rule, value }) => movedBy(rule, value ?? rule.default));
  return (
    <div className={styles.check} ref={panel} tabIndex={-1} role="group" aria-labelledby={title}>
      <p className={styles.checkTitle} id={title}>
        {copy.confirm.title}
      </p>
      {toStandard.map(({ rule }) => (
        <p key={rule.name} className={styles.checkLine}>
          {copy.confirm.standard(rule.title)}
        </p>
      ))}
      <ul className={styles.checkList}>
        {moved.map((each) => (
          <li key={each.key}>{copy.confirm.change(each.label, each.was, each.now)}</li>
        ))}
      </ul>
      <div className={styles.actions}>
        <Button variant="primary" size="small" className={styles.save} disabled={busy} onClick={onSend}>
          {busy ? copy.saving : copy.confirm.send}
        </Button>
        <Button variant="outline" size="small" className={styles.quiet} disabled={busy} onClick={onBack}>
          {copy.confirm.back}
        </Button>
      </div>
    </div>
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
      <div className={styles.fields}>
        {rule.keys.map((key) => (
          <ChoiceField
            key={key}
            id={`${rule.name}-${key}`}
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
    <div className={styles.fields}>
      {Object.entries(draft).map(([key, text]) => (
        <Field
          key={key}
          id={`${rule.name}-${key}`}
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
    <li className={styles.rule} id={rule.name} tabIndex={-1}>
      <fieldset className={styles.group} disabled={held || !allowed.mayChange}>
        <legend className={styles.ruleTitle}>{rule.title}</legend>
        <p className={styles.note}>{rule.note}</p>
        {pricedInPrices && (
          <p className={styles.note}>
            <OpsLink className={styles.link} to={PRICES_PATH}>
              {copy.lateFees}
            </OpsLink>
          </p>
        )}
        <Fields rule={rule} draft={draft} onChange={onEdit} />
        {allowed.mayChange && rule.kind === "number" && rule.keys === "open" && <AddKey rule={rule} onAdd={onEdit} />}
      </fieldset>

      <p className={styles.set}>{setLine(rule)}</p>
      {mayGoBack && (
        <div className={styles.actions}>
          <Button variant="outline" size="small" className={styles.quiet} onClick={onStandard}>
            {copy.reset}
          </Button>
        </div>
      )}
      {refusal !== undefined && (
        <p className={styles.error} role="alert">
          {refusal}
        </p>
      )}
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

/** One subject's rules, under its own heading and anchor, sent together by one Save. */
function GroupSection({ section, allowed, onSaved, children }: GroupSectionProps) {
  const { id, rules } = section;
  const [drafts, setDrafts] = useState<Drafts>(() =>
    Object.fromEntries(rules.map((rule) => [rule.name, draftOf(rule)])),
  );
  const [saving, setSaving] = useState<Saving>({ step: "editing" });

  // A figure that would not move is not a change: the log never records one that was not.
  const changes = changesIn(rules, drafts);
  const checking = saving.step === "checking" || saving.step === "saving";

  const edit = (rule: OpsSetting) => (key: string, text: string) => {
    setDrafts({ ...drafts, [rule.name]: { ...draftIn(drafts, rule), [key]: text } });
    setSaving({ step: "editing" });
  };

  const refusalFor = (rule: OpsSetting): string | undefined => {
    if (saving.step !== "failed" || saving.rule !== rule.name) return undefined;
    return refusalOf(rule, saving.code, saving.fields);
  };

  // One rule at a time, in the order shown: a refusal stops the rest, and says which rule it was.
  const send = async (sending: readonly Change[]) => {
    setSaving({ step: "saving", changes: sending });
    for (const { rule, value } of sending) {
      const answer = await api.setSetting(rule.name, value);
      if (!answer.ok) {
        setSaving({ step: "failed", rule: rule.name, code: answer.code, fields: answer.fields });
        return;
      }
      setDrafts((already) => ({ ...already, [rule.name]: draftOf(answer.body) }));
      onSaved(answer.body);
    }
    setSaving({ step: "saved" });
  };

  const titleId = `${id}-title`;
  return (
    <section className={styles.ruleGroup} id={id} tabIndex={-1} aria-labelledby={titleId}>
      <h3 className={styles.ruleGroupTitle} id={titleId}>
        {GROUP_NAMES[id]}
      </h3>
      {children}
      <ul className={styles.rules}>
        {rules.map((rule) => (
          <Rule
            key={rule.name}
            rule={rule}
            draft={draftIn(drafts, rule)}
            allowed={allowed}
            held={checking}
            refusal={refusalFor(rule)}
            onEdit={edit(rule)}
            onStandard={() => {
              setSaving({ step: "checking", changes: [{ rule, value: null }] });
            }}
          />
        ))}
      </ul>

      {checking && (
        <Check
          id={id}
          changes={saving.changes}
          busy={saving.step === "saving"}
          onSend={() => void send(saving.changes)}
          onBack={() => {
            setSaving({ step: "editing" });
          }}
        />
      )}
      {!checking && allowed.mayChange && (
        <div className={styles.actions}>
          <Button
            variant="primary"
            size="small"
            className={styles.save}
            disabled={changes.length === 0}
            onClick={() => {
              setSaving({ step: "checking", changes });
            }}
          >
            {copy.save}
          </Button>
        </div>
      )}
      {saving.step === "saved" && (
        <p className={styles.saved} role="status">
          {copy.saved}
        </p>
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
    <div className={styles.storage}>
      <p>{settings.storage(storage.held_bytes, storage.share_bytes)}</p>
      <p>{settings.database(storage.database_bytes, storage.database_limit_bytes)}</p>
    </div>
  );
}

/** A link to each section, so a rule is one press away rather than a long scroll. */
function JumpList({ sections }: { sections: readonly RuleSection<OpsSetting>[] }) {
  return (
    <nav className={styles.jump} aria-label={copy.jump}>
      <ul className={styles.jumpList}>
        {sections.map((section) => (
          <li key={section.id}>
            <a className={styles.link} href={`#${section.id}`}>
              {GROUP_NAMES[section.id]}
            </a>
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
    <section className={styles.panel} aria-labelledby="rules">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle} id="rules">
          {copy.title}
        </h2>
      </div>
      <JumpList sections={sections} />
      {sections.map((section) => (
        <GroupSection key={section.id} section={section} allowed={allowed} onSaved={keep}>
          {section.id === CONSOLE_GROUP && <Storage />}
        </GroupSection>
      ))}
    </section>
  );
}
