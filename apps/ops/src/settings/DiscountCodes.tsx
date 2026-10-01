// Settings · Discount codes (docs/decisions/0108-discount-codes.md): making codes, the latest made with how far each
// is used and what it has given, one found by its text, and switching one off. No board draws it, so it is laid out
// as Blackout days is: the form above, then a code a row.
//
// Switching a code off is shown before it is sent, with how many bookings keep it, and only the second press sends
// it (docs/decisions/0071-what-ops-see-before-a-setting-changes.md). A code switched off stays listed, with who
// switched it off, and its uses stay on record.

import { Button } from "@maneman/ui/Button";
import { useLoad } from "@maneman/ui/useLoad";
import { longDate, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useCallback, useState } from "react";
import { api, type DiscountCode } from "../api.ts";
import { settings } from "../content.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { CheckPanel } from "./CheckPanel.tsx";
import { DiscountCodeForm } from "./DiscountCodeForm.tsx";
import { refusalOf, type Failure } from "./refusal.ts";
import styles from "./settings.module.css";

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

function CodeRow({ code, onSwitched }: { code: DiscountCode; onSwitched: () => void }) {
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
      <p className={styles.set}>{copy.madeBy(code.created_by, longDate(code.created_at))}</p>
      {code.switched_off !== null && (
        <p className={styles.set}>{copy.switchedOffBy(code.switched_off.by, longDate(code.switched_off.at))}</p>
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
      {code.switched_off === null && switching !== "checking" && switching !== "sending" && (
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
          {refusalOf(copy.errors, switching)}
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

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} />;
  const { codes, today, batch_most: most } = loaded.value;

  return (
    <section className={styles.panel} aria-labelledby="discount-codes">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle} id="discount-codes">
          {copy.title}
        </h2>
      </div>
      <p className={styles.note}>{copy.note}</p>
      <DiscountCodeForm today={today} most={most} onMade={retry} />
      <FindForm finding={finding} onFind={setFinding} />
      {codes.length === 0 ? (
        <p className={styles.note}>{finding === null ? copy.none : copy.noneFound}</p>
      ) : (
        <ul className={styles.rules}>
          {codes.map((code) => (
            <CodeRow key={code.id} code={code} onSwitched={retry} />
          ))}
        </ul>
      )}
    </section>
  );
}
