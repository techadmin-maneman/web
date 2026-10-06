// Finance · Discount codes (docs/decisions/0108-discount-codes.md): making codes, the latest made with how far each
// is used and what it has given, one found by its text, and switching one off. No board draws it, so it is laid out
// as Blackout days is: the form above, then a code a row.
//
// Switching a code off is shown before it is sent, with how many bookings keep it, and only the second press sends
// it (docs/decisions/0071-what-ops-see-before-a-setting-changes.md). A code switched off stays listed, with who
// switched it off, and its uses stay on record.

import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { Panel } from "@maneman/ui/Panel";
import { Button } from "@maneman/ui/Button";
import { useLoad } from "@maneman/ui/useLoad";
import { longDate, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useCallback, useState } from "react";
import { api, type DiscountCode } from "../api.ts";
import { settings } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { whoWords } from "../lib/who.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { CheckPanel } from "../components/CheckPanel.tsx";
import { DiscountCodeForm } from "./DiscountCodeForm.tsx";
import styles from "../components/forms.module.css";

const copy = settings.discountCodes;

/** What a code takes off, its limits and what it has given, on one line. */
function factsOf(code: DiscountCode): string {
  const off = code.kind === "amount" ? rupees(code.value) : copy.percentOff(code.value, capOf(code));
  const covered = code.covers.map((kind) => copy.coverNames[kind] ?? kind).join("; ");
  return [
    copy.off(off),
    copy.covering(covered),
    copy.until(code.expires_on === null ? null : shortDate(code.expires_on)),
    copy.usesOf(code.uses, code.max_uses),
    copy.given(rupees(code.given)),
  ].join(" · ");
}

const capOf = (code: DiscountCode): string | null => (code.cap === null ? null : rupees(code.cap));

type Switching = "idle" | "checking" | "sending" | Failure;

interface CodeRowProps {
  readonly code: DiscountCode;
  /** Whether the person's access lets them switch a code off. */
  readonly maySwitchOff: boolean;
  readonly onSwitched: () => void;
}

function CodeRow({ code, maySwitchOff, onSwitched }: CodeRowProps) {
  const [switching, setSwitching] = useState<Switching>("idle");

  const switchOff = async () => {
    setSwitching("sending");
    const answer = await api.switchOffDiscountCode(code.id);
    if (!answer.ok) {
      setSwitching({ code: answer.code, fields: answer.fields });
      return;
    }
    setSwitching("idle");
    onSwitched();
  };

  return (
    <li className={styles.rule}>
      <p className={styles.period}>{code.code}</p>
      <p className={styles.set}>{factsOf(code)}</p>
      <p className={styles.set}>{copy.madeBy(whoWords(code.created_by), longDate(code.created_at))}</p>
      {code.switched_off !== null && (
        <p className={styles.set}>
          {copy.switchedOffBy(whoWords(code.switched_off.by), longDate(code.switched_off.at))}
        </p>
      )}
      {code.switched_off === null && (switching === "checking" || switching === "sending") && (
        <CheckPanel
          title={copy.switchTitle(code.code)}
          lines={[copy.switchLine(code.uses)]}
          send={copy.switchOff}
          sending={copy.switching}
          back={copy.back}
          busy={switching === "sending"}
          onSend={() => void switchOff()}
          onBack={() => {
            setSwitching("idle");
          }}
        />
      )}
      {maySwitchOff && code.switched_off === null && switching !== "checking" && switching !== "sending" && (
        <div className={styles.actions}>
          <Button
            variant="outline"
            size="small"
            className={styles.quiet}
            aria-label={copy.switchOffLabel(code.code)}
            onClick={() => {
              setSwitching("checking");
            }}
          >
            {copy.switchOff}
          </Button>
        </div>
      )}
      {typeof switching === "object" && (
        <p className={styles.error} role="alert">
          {errorText(copy.errors, switching)}
        </p>
      )}
    </li>
  );
}

function FindForm({ finding, onFind }: { finding: string | null; onFind: (code: string | null) => void }) {
  const [text, setText] = useState(finding ?? "");
  return (
    <form
      className={styles.group}
      aria-label={copy.find}
      onSubmit={(event) => {
        event.preventDefault();
        onFind(text.trim() === "" ? null : text.trim());
      }}
    >
      <div className={styles.fields}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="code-find">
            {copy.find}
          </label>
          <input
            id="code-find"
            className={styles.text}
            type="search"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
        </div>
      </div>
      <div className={styles.actions}>
        <Button type="submit" variant="outline" size="small" className={styles.quiet}>
          {copy.findButton}
        </Button>
        {finding !== null && (
          <Button
            variant="outline"
            size="small"
            className={styles.quiet}
            onClick={() => {
              setText("");
              onFind(null);
            }}
          >
            {copy.showAll}
          </Button>
        )}
      </div>
    </form>
  );
}

export function DiscountCodes() {
  const [finding, setFinding] = useState<string | null>(null);
  const load = useCallback(() => api.discountCodes(finding), [finding]);
  const [loaded, retry] = useLoad(load);
  /** The list as it was read again after a change, so the form above it keeps what it says. */
  const [refreshed, setRefreshed] = useState<readonly DiscountCode[] | null>(null);
  const access = useAccess();
  const mayMake = access.mayCall("POST /api/discount-codes");
  const maySwitchOff = access.mayCall("POST /api/discount-codes/{id}/off");

  const find = (code: string | null) => {
    setRefreshed(null);
    setFinding(code);
  };
  const refresh = async () => {
    const answer = await api.discountCodes(finding);
    if (answer.ok) setRefreshed(answer.body.codes);
  };

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const { today, batch_most: most } = loaded.value;
  const codes = refreshed ?? loaded.value.codes;

  return (
    <Panel titleId="discount-codes" title={copy.title} className={styles.panel}>
      <p className={styles.note}>{copy.note}</p>
      {mayMake && <DiscountCodeForm today={today} most={most} onMade={() => void refresh()} />}
      <FindForm finding={finding} onFind={find} />
      {codes.length === 0 ? (
        <p className={styles.note}>{finding === null ? copy.none : copy.noneFound}</p>
      ) : (
        <ul className={styles.rules}>
          {codes.map((code) => (
            <CodeRow key={code.id} code={code} maySwitchOff={maySwitchOff} onSwitched={() => void refresh()} />
          ))}
        </ul>
      )}
    </Panel>
  );
}
