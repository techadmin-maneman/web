// A Settings page of policies: the rule groups it names (../route.ts, SETTINGS_PAGES), a panel each, every figure or
// choice a row of its own, changed where it reads (docs/decisions/0212-editing-in-place.md). A row saves its own
// figure at once, and says so beside it; a rule set by hand can be put back to its standard. A person who may only
// look sees each value as it reads.

import { Button } from "@maneman/ui/Button";
import { Stack } from "@maneman/ui/Layout";
import { Note } from "@maneman/ui/Note";
import { Panel } from "@maneman/ui/Panel";
import { useLoad } from "@maneman/ui/useLoad";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useState, type ReactNode } from "react";
import { type OpsSetting } from "../api.ts";
import { Refusal } from "../components/Refusal.tsx";
import { useHeaderSub } from "../components/PageHead.tsx";
import { OpsLink } from "../components/Shell.tsx";
import { settings } from "../content/settings.ts";
import { useAccess } from "../lib/access.ts";
import { useTargetRow } from "../lib/target.ts";
import { settingsPath } from "../route.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { RuleRows, saveRule } from "./RuleFields.tsx";
import { CHARGES_A_LATE_FEE, CONSOLE_GROUP, sectionsOf, type RuleGroupId, type RuleSection } from "./rule-groups.ts";
import { settingsApi } from "./settings-api.ts";
import styles from "./rules.module.css";

const copy = settings.rules;

/** Each group's heading, from content.ts; typed here, so a group left unnamed fails the build. */
const GROUP_NAMES: Readonly<Record<RuleGroupId, string>> = copy.groups;

/** What the person's access lets them do here: change the rules, and open where the late fees are priced. */
interface Allowed {
  readonly mayChange: boolean;
  readonly mayOpenPrices: boolean;
}

/** A rule set by hand, put back to its standard figures in one press. */
function Standard({ rule, onSaved }: { readonly rule: OpsSetting; readonly onSaved: (saved: OpsSetting) => void }) {
  const [busy, once] = useOneAtATime();
  const [refused, setRefused] = useState<string | null>(null);
  return (
    <div className={styles.standard}>
      <Button
        variant="quiet"
        size="small"
        narrow
        busy={busy}
        aria-label={copy.resetLabel(rule.title)}
        onClick={() => void once(async () => { setRefused(await saveRule(rule, null, onSaved)); })}
      >
        {copy.reset}
      </Button>
      {refused !== null && <Refusal className={styles.refusal} said={refused} />}
    </div>
  );
}

function Rule({
  rule,
  allowed,
  onSaved,
}: {
  readonly rule: OpsSetting;
  readonly allowed: Allowed;
  readonly onSaved: (saved: OpsSetting) => void;
}) {
  const single = typeof rule.value === "number";
  const pricedInPrices = allowed.mayOpenPrices && CHARGES_A_LATE_FEE.includes(rule.name);
  return (
    <div
      className={styles.rule}
      role="group"
      aria-label={rule.title}
      id={single ? undefined : rule.name}
      tabIndex={single ? undefined : -1}
    >
      {!single && <h3 className={styles.ruleTitle}>{rule.title}</h3>}
      {pricedInPrices && (
        <Note>
          <OpsLink to={settingsPath("services")}>{copy.lateFees}</OpsLink>
        </Note>
      )}
      <RuleRows rule={rule} mayChange={allowed.mayChange} onSaved={onSaved} />
      {allowed.mayChange && rule.set_by !== null && <Standard rule={rule} onSaved={onSaved} />}
    </div>
  );
}

/** One subject's rules in a panel, each row saved on its own. */
function Group({
  section,
  allowed,
  onSaved,
  children,
}: {
  readonly section: RuleSection<OpsSetting>;
  readonly allowed: Allowed;
  readonly onSaved: (saved: OpsSetting) => void;
  /** What the group shows above its rules. */
  readonly children?: ReactNode;
}) {
  return (
    <Panel id={section.id} titleId={`${section.id}-title`} title={GROUP_NAMES[section.id]}>
      {children}
      {section.rules.map((rule) => (
        <Rule key={rule.name} rule={rule} allowed={allowed} onSaved={onSaved} />
      ))}
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
  // A link to a rule, as the fees' link to the late-fee rule, lands on it once the rules are on the page.
  useTargetRow(loaded.state === "loaded", "start");
  useHeaderSub(allowed.mayChange ? undefined : copy.viewOnly);

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
