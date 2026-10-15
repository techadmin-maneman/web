// A Settings page of policies: the rule groups it names (../route.ts, SETTINGS_PAGES), a panel each, every figure or
// choice a row of its own. A draft is text, never a number, since an empty box read as nought would be a radius no
// arrival passes. Once a group's boxes move, a bar says how many changes wait; Review shows each figure old beside new,
// and only Confirm sends them. A person who may only look sees each value as it reads.

import { Button } from "@maneman/ui/Button";
import { Fieldset } from "@maneman/ui/Field";
import { InlineMessage } from "@maneman/ui/InlineMessage";
import { Stack } from "@maneman/ui/Layout";
import { Note } from "@maneman/ui/Note";
import { Panel } from "@maneman/ui/Panel";
import { ChangeBar } from "@maneman/ui/SettingsLayout";
import { useLoad } from "@maneman/ui/useLoad";
import { useState, type ReactNode } from "react";
import { type OpsSetting } from "../api.ts";
import { CheckPanel } from "../components/CheckPanel.tsx";
import { FormActions } from "../components/FormActions.tsx";
import { Refusal } from "../components/Refusal.tsx";
import { OpsLink } from "../components/Shell.tsx";
import { review as reviewWords } from "../content/common.ts";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import { useTargetRow } from "../lib/target.ts";
import { settingsPath } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { AddKey, Fields, Values } from "./RuleFields.tsx";
import {
  changesIn,
  draftIn,
  draftOf,
  movedBy,
  ruleRefusal,
  type Change,
  type Draft,
  type Drafts,
} from "./rule-drafts.ts";
import { CHARGES_A_LATE_FEE, CONSOLE_GROUP, sectionsOf, type RuleGroupId, type RuleSection } from "./rule-groups.ts";
import { useSteps, type Sent } from "./SettingForm.tsx";
import { settingsApi } from "./settings-api.ts";
import styles from "./rules.module.css";

const copy = settings.rules;

/** Each group's heading, from content.ts; typed here, so a group left unnamed fails the build. */
const GROUP_NAMES: Readonly<Record<RuleGroupId, string>> = copy.groups;

/** The old figure beside the new, for every one the group's change moves, before anything is sent. */
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

/** What the person's access lets them do here: change the rules, and open Services, where the late fees are priced. */
interface Allowed {
  readonly mayChange: boolean;
  readonly mayOpenPrices: boolean;
}

interface RuleProps {
  readonly rule: OpsSetting;
  readonly draft: Draft;
  readonly allowed: Allowed;
  /** While the group's change is checked or sent, every box holds still. */
  readonly held: boolean;
  readonly refusal: string | undefined;
  readonly onEdit: (key: string, text: string) => void;
  readonly onStandard: () => void;
}

function Rule({ rule, draft, allowed, held, refusal, onEdit, onStandard }: RuleProps) {
  const single = typeof rule.value === "number";
  const pricedInPrices = allowed.mayOpenPrices && CHARGES_A_LATE_FEE.includes(rule.name);
  const mayGoBack = allowed.mayChange && !held && rule.set_by !== null;
  return (
    <div className={styles.rule} id={single ? undefined : rule.name} tabIndex={single ? undefined : -1}>
      {!single && <h3 className={styles.ruleTitle}>{rule.title}</h3>}
      {pricedInPrices && (
        <Note>
          <OpsLink to={settingsPath("services")}>{copy.lateFees}</OpsLink>
        </Note>
      )}
      {allowed.mayChange ? (
        <Fieldset legend={rule.title} legendLook="hidden" disabled={held}>
          <Fields rule={rule} draft={draft} onChange={onEdit} />
          {rule.kind === "number" && rule.keys === "open" && <AddKey rule={rule} onAdd={onEdit} />}
        </Fieldset>
      ) : (
        <Values rule={rule} />
      )}
      {mayGoBack && (
        <FormActions>
          <Button variant="quiet" size="small" narrow onClick={onStandard}>
            {copy.reset}
          </Button>
        </FormActions>
      )}
      {refusal !== undefined && <Refusal className={styles.refusal} said={refusal} />}
    </div>
  );
}

/** How many changes wait in a group, with the way to drop them or to see them before they are sent. */
function Pending({ count, onDiscard, onReview }: { count: number; onDiscard: () => void; onReview: () => void }) {
  return (
    <ChangeBar count={copy.changes(count)}>
      <Button variant="quiet" size="small" onClick={onDiscard}>
        {copy.discard}
      </Button>
      <Button variant="primary" size="small" onClick={onReview}>
        {reviewWords.next}
      </Button>
    </ChangeBar>
  );
}

interface GroupProps {
  readonly section: RuleSection<OpsSetting>;
  readonly allowed: Allowed;
  readonly onSaved: (saved: OpsSetting) => void;
  /** What the group shows above its rules. */
  readonly children?: ReactNode;
}

/**
 * A group's drafts and their sending: one rule at a time, in the order shown, a refusal stopping the rest and saying
 * which rule it was; and the check before anything goes.
 */
function useGroup(rules: readonly OpsSetting[], onSaved: (saved: OpsSetting) => void) {
  const standing = () => Object.fromEntries(rules.map((rule) => [rule.name, draftOf(rule)]));
  const [drafts, setDrafts] = useState<Drafts>(standing);
  /** What the check shows and Confirm sends: the group's changes, or one rule put back to its standard. */
  const [sending, setSending] = useState<readonly Change[]>([]);
  /** The rule a refusal stopped at, which says so beneath its rows. */
  const [refusedRule, setRefusedRule] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
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
  return {
    drafts,
    sending,
    saved,
    steps,
    // A figure that would not move is not a change: the log never records one that was not.
    changes: changesIn(rules, drafts),
    review: (these: readonly Change[]) => {
      setSending(these);
      setRefusedRule(null);
      steps.check();
    },
    edit: (rule: OpsSetting) => (key: string, text: string) => {
      setDrafts({ ...drafts, [rule.name]: { ...draftIn(drafts, rule), [key]: text } });
      setSaved(false);
      setRefusedRule(null);
      steps.edit();
    },
    discard: () => {
      setDrafts(standing());
      setRefusedRule(null);
    },
    refusalFor: (rule: OpsSetting): string | undefined => {
      if (steps.failed === null || refusedRule !== rule.name) return undefined;
      return ruleRefusal(rule, steps.failed.code, steps.failed.fields ?? []);
    },
  };
}

/** One subject's rules in a panel, reviewed and sent together. */
function Group({ section, allowed, onSaved, children }: GroupProps) {
  const { id, rules } = section;
  const { drafts, sending, saved, steps, changes, review, edit, discard, refusalFor } = useGroup(rules, onSaved);
  return (
    <Panel id={id} titleId={`${id}-title`} title={GROUP_NAMES[id]}>
      {children}
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
      {steps.step !== "editing" && (
        <div className={styles.check}>
          <Check changes={sending} busy={steps.step === "saving"} onSend={steps.go} onBack={steps.edit} />
        </div>
      )}
      {steps.step === "editing" && allowed.mayChange && changes.length > 0 && (
        <Pending
          count={changes.length}
          onDiscard={discard}
          onReview={() => {
            review(changes);
          }}
        />
      )}
      {saved && (
        <InlineMessage tone="saved" className={styles.saved}>
          {copy.saved}
        </InlineMessage>
      )}
    </Panel>
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

export function Rules({ groups }: { readonly groups: readonly RuleGroupId[] }) {
  const [loaded, retry] = useLoad(settingsApi.settings);
  /** What each rule reads as now, so a save shows without reading the whole list again. */
  const [saved, setSaved] = useState<Readonly<Record<string, OpsSetting>>>({});
  const access = useAccess();
  const allowed: Allowed = {
    mayChange: access.mayCall("POST /api/settings/{name}"),
    mayOpenPrices: access.mayCall("GET /api/services"),
  };
  // A link to a rule, as Services' to the late-fee rule, lands on it once the rules are on the page.
  useTargetRow(loaded.state === "loaded", "start");

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;

  const current = loaded.value.settings.map((rule) => saved[rule.name] ?? rule);
  const sections = sectionsOf(current).filter((section) => groups.includes(section.id));
  const keep = (next: OpsSetting) => {
    setSaved((already) => ({ ...already, [next.name]: next }));
  };

  return (
    <Stack>
      {sections.map((section) => (
        <Group key={section.id} section={section} allowed={allowed} onSaved={keep}>
          {section.id === CONSOLE_GROUP && <Storage />}
        </Group>
      ))}
    </Stack>
  );
}
