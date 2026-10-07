// Finance · Discount codes (docs/decisions/0108-discount-codes.md): what every code has come to, then the codes in a
// table that sorts, each with its uses, clients, what it gave and what was paid. A code is made from Make codes, found by
// how it begins, switched off, or, while no booking has taken it, deleted.
//
// Switching a code off is shown before it is sent, and only the second press sends it
// (docs/decisions/0071-what-ops-see-before-a-setting-changes.md). Codes switched off fold away beneath the table, their
// uses on record.

import { errorText, type Failure } from "@maneman/web-kit/refusal";
import { Panel } from "@maneman/ui/Panel";
import { Button } from "@maneman/ui/Button";
import { Field, TextInput } from "@maneman/ui/Field";
import { Table } from "@maneman/ui/Table";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { classes } from "@maneman/ui/classes";
import { useLoad } from "@maneman/ui/useLoad";
import { indiaDate, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useCallback, useState, type ReactNode } from "react";
import { api, type DiscountCode, type DiscountCodes as Book } from "../api.ts";
import { settings } from "../content.ts";
import { useAccess } from "../lib/access.ts";
import { Loading, PanelFailed } from "../states/States.tsx";
import { CheckPanel } from "../components/CheckPanel.tsx";
import { DeleteAction } from "../components/DeleteAction.tsx";
import { Narrowing, SortHeads, TableEnd } from "../components/TableTools.tsx";
import { useTableView, type Column } from "../components/useTableView.ts";
import { DiscountCodeForm } from "./DiscountCodeForm.tsx";
import styles from "../components/forms.module.css";
import own from "./discount-codes.module.css";

const copy = settings.discountCodes;
const columns = copy.columns;

const discountOf = (code: DiscountCode): string =>
  code.kind === "amount"
    ? rupees(code.value)
    : copy.percentOff(code.value, code.cap === null ? null : rupees(code.cap));
const coversOf = (code: DiscountCode): string => code.covers.map((kind) => copy.coverShort[kind] ?? kind).join(", ");
const dayOf = (instant: string | null): string => (instant === null ? copy.never : shortDate(indiaDate(instant)));
const usesOf = (code: DiscountCode): string =>
  code.max_uses === null ? String(code.uses) : copy.usesOf(code.uses, code.max_uses);

/** What every code has come to together, standing uses only. */
function Figures({ totals }: { totals: Book["totals"] }) {
  const figures: readonly (readonly [string, string])[] = [
    [copy.figures.live, String(totals.live)],
    [copy.figures.uses, String(totals.uses)],
    [copy.figures.clients, String(totals.clients)],
    [copy.figures.given, rupees(totals.given)],
    [copy.figures.paid, rupees(totals.paid)],
  ];
  return (
    <dl className={own.figures}>
      {figures.map(([label, value]) => (
        <div key={label} className={own.total}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** What is open beneath a code's row: the check before switching it off, or the question before deleting it. */
type Acting = { readonly id: string; readonly kind: "off" | "delete" } | null;

/** Which row actions the person's access reaches. */
interface May {
  readonly off: boolean;
  readonly delete: boolean;
}

/** What a row needs to offer its actions and show what they open. */
interface RowProps {
  readonly acting: Acting;
  readonly may: May;
  readonly onAct: (acting: Acting) => void;
  readonly onDone: (said: string) => void;
}

/** The check before a code is switched off; only its second press sends. */
function SwitchOffCheck({ code, onDone, onBack }: { code: DiscountCode; onDone: () => void; onBack: () => void }) {
  const [step, setStep] = useState<"checking" | "sending" | Failure>("checking");
  const send = async () => {
    setStep("sending");
    const answer = await api.switchOffDiscountCode(code.id);
    if (!answer.ok) {
      setStep({ code: answer.code, fields: answer.fields });
      return;
    }
    onDone();
  };
  return (
    <>
      <CheckPanel
        title={copy.switchTitle(code.code)}
        lines={[copy.switchLine(code.uses)]}
        send={copy.switchOff}
        sending={copy.switching}
        back={copy.back}
        busy={step === "sending"}
        onSend={() => void send()}
        onBack={onBack}
      />
      {typeof step === "object" && (
        <p className={styles.error} role="alert">
          {errorText(copy.errors, step)}
        </p>
      )}
    </>
  );
}

/** A code's row actions: switched off while it is on, and deleted while no booking has taken it. */
function RowActions({ code, acting, may, onAct }: { code: DiscountCode } & Omit<RowProps, "onDone">) {
  return (
    <td className={own.actions}>
      {may.off && code.switched_off === null && (
        <button
          className={styles.inline}
          type="button"
          aria-label={copy.switchOffLabel(code.code)}
          disabled={acting !== null}
          onClick={() => {
            onAct({ id: code.id, kind: "off" });
          }}
        >
          {copy.switchOff}
        </button>
      )}
      {may.delete && code.deletable && (
        <button
          className={styles.inline}
          type="button"
          aria-label={copy.deleteLabel(code.code)}
          disabled={acting !== null}
          onClick={() => {
            onAct({ id: code.id, kind: "delete" });
          }}
        >
          {copy.delete}
        </button>
      )}
    </td>
  );
}

/** Beneath a code's row, what its action opened. */
function ActingRow({ code, span, acting, onAct, onDone }: { code: DiscountCode; span: number } & RowProps) {
  if (acting?.id !== code.id) return null;
  const cancel = () => {
    onAct(null);
  };
  return (
    <tr className={own.acting}>
      <td colSpan={span}>
        {acting.kind === "off" ? (
          <SwitchOffCheck
            code={code}
            onDone={() => {
              onDone(copy.switchedOff);
            }}
            onBack={cancel}
          />
        ) : (
          <div className={own.ask}>
            <DeleteAction
              name={code.code}
              send={() => api.deleteDiscountCode(code.id)}
              refusal={(refused) =>
                refused === "in_use" ? copy.inUse : errorText(copy.errors, { code: refused, fields: [] })
              }
              onDeleted={() => {
                onDone(copy.deleted);
              }}
              onCancel={cancel}
            />
          </div>
        )}
      </td>
    </tr>
  );
}

const ON_COLUMNS = 10;

/** A code still on: its terms and its figures, and beneath it what its action opened. */
function CodeRows({ code, today, ...row }: { code: DiscountCode; today: string } & RowProps) {
  const ends =
    code.expires_on === null
      ? copy.noEnd
      : (code.expires_on < today ? copy.ended : copy.ends)(shortDate(code.expires_on));
  return (
    <>
      <tr>
        <th scope="row" className={own.code}>
          {code.code}
        </th>
        <td>{discountOf(code)}</td>
        <td>{coversOf(code)}</td>
        <td>{ends}</td>
        <td className={own.figure}>{usesOf(code)}</td>
        <td className={own.figure}>{code.clients}</td>
        <td className={own.figure}>{rupees(code.given)}</td>
        <td className={own.figure}>{rupees(code.paid)}</td>
        <td>{dayOf(code.last_used)}</td>
        <RowActions code={code} {...row} />
      </tr>
      <ActingRow code={code} span={ON_COLUMNS} {...row} />
    </>
  );
}

/** The codes still on: sorted by any column, narrowed by what they apply to. */
function CodesTable({
  codes,
  today,
  find,
  ...row
}: { codes: readonly DiscountCode[]; today: string; find: ReactNode } & RowProps) {
  const tableColumns: readonly Column<DiscountCode>[] = [
    { label: columns.code, sort: (code) => code.code },
    { label: columns.discount },
    { label: columns.covers, choice: coversOf },
    { label: columns.ends, sort: (code) => code.expires_on ?? "9999-12-31" },
    { label: columns.uses, sort: (code) => code.uses, figure: true },
    { label: columns.clients, sort: (code) => code.clients, figure: true },
    { label: columns.given, sort: (code) => code.given, figure: true },
    { label: columns.paid, sort: (code) => code.paid, figure: true },
    { label: columns.lastUsed, sort: (code) => code.last_used ?? "" },
  ];
  const view = useTableView(codes, tableColumns);
  return (
    <>
      <div className={own.tools}>
        {find}
        <Narrowing view={view} label={copy.narrow} className={own.narrow} />
      </div>
      <div className={own.scroll}>
        <Table className={classes(styles.table, own.table)}>
          <thead>
            <tr>
              <SortHeads view={view} />
              <th scope="col">
                <VisuallyHidden>{columns.actions}</VisuallyHidden>
              </th>
            </tr>
          </thead>
          <tbody>
            {view.shown.map((code) => (
              <CodeRows key={code.id} code={code} today={today} {...row} />
            ))}
          </tbody>
        </Table>
      </div>
      <TableEnd view={view} />
    </>
  );
}

const OFF_COLUMNS = 7;

/** A code switched off: its figures stay, and one never used may still be deleted. */
function OffRows({ code, ...row }: { code: DiscountCode } & RowProps) {
  return (
    <>
      <tr>
        <th scope="row" className={own.code}>
          {code.code}
        </th>
        <td>{discountOf(code)}</td>
        <td className={own.figure}>{usesOf(code)}</td>
        <td className={own.figure}>{rupees(code.given)}</td>
        <td className={own.figure}>{rupees(code.paid)}</td>
        <td>{dayOf(code.switched_off?.at ?? null)}</td>
        <RowActions code={code} {...row} />
      </tr>
      <ActingRow code={code} span={OFF_COLUMNS} {...row} />
    </>
  );
}

/** The codes switched off, folded beneath the table. */
function SwitchedOff({ codes, ...row }: { codes: readonly DiscountCode[] } & RowProps) {
  if (codes.length === 0) return null;
  const heads: readonly (readonly [string, boolean])[] = [
    [columns.code, false],
    [columns.discount, false],
    [columns.uses, true],
    [columns.given, true],
    [columns.paid, true],
    [columns.offOn, false],
  ];
  return (
    <details className={own.off}>
      <summary className={own.offSummary}>{copy.switchedOffTitle(codes.length)}</summary>
      <div className={own.scroll}>
        <Table className={classes(styles.table, own.table)}>
          <thead>
            <tr>
              {heads.map(([label, figure]) => (
                <th key={label} scope="col" className={figure ? own.figure : undefined}>
                  {label}
                </th>
              ))}
              <th scope="col">
                <VisuallyHidden>{columns.actions}</VisuallyHidden>
              </th>
            </tr>
          </thead>
          <tbody>
            {codes.map((code) => (
              <OffRows key={code.id} code={code} {...row} may={{ off: false, delete: row.may.delete }} />
            ))}
          </tbody>
        </Table>
      </div>
    </details>
  );
}

/** Codes found by how they begin, however old: the list holds the latest made. */
function FindForm({ finding, onFind }: { finding: string | null; onFind: (code: string | null) => void }) {
  const [text, setText] = useState(finding ?? "");
  return (
    <form
      className={own.find}
      role="search"
      aria-label={copy.find}
      onSubmit={(event) => {
        event.preventDefault();
        onFind(text.trim() === "" ? null : text.trim());
      }}
    >
      <Field label={copy.find}>
        {(control) => (
          <TextInput
            {...control}
            type="search"
            value={text}
            onChange={(event) => {
              setText(event.currentTarget.value);
            }}
          />
        )}
      </Field>
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
    </form>
  );
}

export function DiscountCodes() {
  const [finding, setFinding] = useState<string | null>(null);
  const load = useCallback(() => api.discountCodes(finding), [finding]);
  const [loaded, retry] = useLoad(load);
  /** The list as it was read again after a change, so what was typed above it stays. */
  const [refreshed, setRefreshed] = useState<Book | null>(null);
  const [making, setMaking] = useState(false);
  const [acting, setActing] = useState<Acting>(null);
  const [said, setSaid] = useState<string | null>(null);
  const access = useAccess();
  const mayMake = access.mayCall("POST /api/discount-codes");
  const may: May = {
    off: access.mayCall("POST /api/discount-codes/{id}/off"),
    delete: access.mayCall("POST /api/discount-codes/{id}/delete"),
  };

  const find = (code: string | null) => {
    setRefreshed(null);
    setFinding(code);
  };
  const refresh = async () => {
    const answer = await api.discountCodes(finding);
    if (answer.ok) setRefreshed(answer.body);
  };
  const row: RowProps = {
    acting,
    may,
    onAct: (next) => {
      setSaid(null);
      setActing(next);
    },
    onDone: (words) => {
      setActing(null);
      setSaid(words);
      void refresh();
    },
  };

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <PanelFailed onRetry={retry} requestId={loaded.requestId} />;
  const book = refreshed ?? loaded.value;
  const on = book.codes.filter((code) => code.switched_off === null);
  const findForm = <FindForm finding={finding} onFind={find} />;
  const off = book.codes.filter((code) => code.switched_off !== null);

  return (
    <Panel
      titleId="discount-codes"
      title={copy.title}
      className={styles.panel}
      actions={
        mayMake &&
        !making && (
          <Button
            variant="outline"
            size="small"
            className={styles.quiet}
            onClick={() => {
              setMaking(true);
            }}
          >
            {copy.make}
          </Button>
        )
      }
    >
      <Figures totals={book.totals} />
      {making && (
        <DiscountCodeForm
          today={book.today}
          most={book.batch_most}
          onMade={() => void refresh()}
          onClose={() => {
            setMaking(false);
          }}
        />
      )}
      {said !== null && (
        <p className={styles.saved} role="status">
          {said}
        </p>
      )}
      {book.codes.length === 0 ? (
        <>
          <div className={own.tools}>{findForm}</div>
          <p className={styles.note}>{finding === null ? copy.none : copy.noneFound}</p>
        </>
      ) : (
        <>
          <CodesTable codes={on} today={book.today} find={findForm} {...row} />
          <SwitchedOff codes={off} {...row} />
        </>
      )}
    </Panel>
  );
}
