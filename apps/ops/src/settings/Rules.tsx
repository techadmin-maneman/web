// Settings › Rules: every rule ops set for themselves, a section per subject, each with one Save. A number states its
// unit and bounds, and a draft is text, never a number, since an empty box read as nought would be a radius no arrival
// passes. Each figure that moves is shown old beside new before the second press sends it.

import { TextLink } from "@maneman/ui/TextLink";
import { Panel } from "@maneman/ui/Panel";
import { Fieldset } from "@maneman/ui/Field";
import { CheckPanel } from "../components/CheckPanel.tsx";
import { ReviewBar } from "./ReviewBar.tsx";
import { useSteps, type Sent } from "./SettingForm.tsx";
import { Button } from "@maneman/ui/Button";
import { Note } from "@maneman/ui/Note";
import { useLoad } from "@maneman/ui/useLoad";
import { useState, type ReactNode } from "react";
import { type OpsSetting } from "../api.ts";
import { OpsLink } from "../components/Shell.tsx";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import { useTargetRow } from "../lib/target.ts";
import type { SectionPath } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import {
  ruleRefusal,
  draftOf,
  draftIn,
  movedBy,
  changesIn,
  type Change,
  type Draft,
  type Drafts,
} from "./rule-drafts.ts";
import { CHARGES_A_LATE_FEE, CONSOLE_GROUP, sectionsOf, type RuleGroupId, type RuleSection } from "./rule-groups.ts";
import form from "../components/forms.module.css";
import styles from "./rules.module.css";
import { Refusal } from "../components/Refusal.tsx";
import { FormActions } from "../components/FormActions.tsx";
import { settingsApi } from "./settings-api.ts";
import { AddKey, Fields, Boxes } from "./RuleFields.tsx";

const copy = settings.rules;

/** Where the late fees are priced. */
const PRICES_PATH: SectionPath = "/prices";

/** Each section's heading, from content.ts; typed here, so a group left unnamed fails the build. */
const GROUP_NAMES: Readonly<Record<RuleGroupId, string>> = copy.groups;

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
      <ul className={styles.checkList}>
        {moved.map((each) => (
          <li key={each.key}>{copy.confirm.change(each.label, each.was, each.now)}</li>
        ))}
      </ul>
    </CheckPanel>
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
          <Note>
            <OpsLink className={form.link} to={PRICES_PATH}>
              {copy.lateFees}
            </OpsLink>
          </Note>
        )}
        <Boxes rule={rule} draft={draft}>
          <Fields rule={rule} draft={draft} onChange={onEdit} />
          {allowed.mayChange && rule.kind === "number" && rule.keys === "open" && <AddKey rule={rule} onAdd={onEdit} />}
        </Boxes>
      </Fieldset>

      {mayGoBack && (
        <FormActions>
          <Button variant="outline" size="small" narrow onClick={onStandard}>
            {copy.reset}
          </Button>
        </FormActions>
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
  const { id, rules } = section;
  const [drafts, setDrafts] = useState<Drafts>(() =>
    Object.fromEntries(rules.map((rule) => [rule.name, draftOf(rule)])),
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
        const answer = await settingsApi.setSetting(rule.name, value);
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
  const changes = changesIn(rules, drafts);
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
    <section className={styles.ruleGroup} id={id} tabIndex={-1} aria-labelledby={titleId}>
      <h3 className={styles.ruleGroupTitle} id={titleId}>
        {GROUP_NAMES[id]}
      </h3>
      {children}
      <ul className={form.rules}>
        {rules.map((rule) => (
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
  const [loaded] = useLoad(settingsApi.storage);
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
            <TextLink href={`#${section.id}`}>{GROUP_NAMES[section.id]}</TextLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function Rules() {
  const [loaded, retry] = useLoad(settingsApi.settings);
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
    <Panel titleId="rules" title={copy.title} padded>
      <JumpList sections={sections} />
      {sections.map((section) => (
        <GroupSection key={section.id} section={section} allowed={allowed} onSaved={keep}>
          {section.id === CONSOLE_GROUP && <Storage />}
        </GroupSection>
      ))}
    </Panel>
  );
}
